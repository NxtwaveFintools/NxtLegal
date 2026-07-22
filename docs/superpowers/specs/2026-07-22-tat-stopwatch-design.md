# TAT Stopwatch — Design Spec

**Date:** 2026-07-22
**Status:** Approved (pending user review of this document)
**Scope:** SQL migration + one-time backfill script only. **Nothing is applied to any database as part of this work** — files are written and reviewed first.

## 1. Problem

The SLA clock (`contracts.tat_deadline_at`) currently runs continuously from the first HOD approval. Business rule: the clock must only run while a contract is in `UNDER_REVIEW`.

- **Pause** when a contract leaves `UNDER_REVIEW`.
- **Resume** when it re-enters `UNDER_REVIEW`, pushing the deadline forward by the paused business days.
- The clock starts at the **first HOD approval** and **nothing ever resets it** (user-confirmed rule).

Known bug fixed as part of this: after `legal.query.reroute` (UNDER_REVIEW → HOD_PENDING) a re-approve crashes, because `enforce_contract_tat_mutability()` only permits setting `tat_deadline_at` when `OLD.tat_deadline_at IS NULL`.

### Hard constraint

`aging_business_days` (computed in `contracts_repository_view` from `hod_approved_at` → now) is **not modified in any way**. Neither is `hod_approved_at`, `tat_breached_at` handling, nor the view itself.

## 2. Verified codebase facts (basis for this design)

| Fact | Evidence |
|---|---|
| Audit table is `public.audit_logs`; transitions carry `metadata.from_status` / `metadata.to_status`, `resource_type='contract'`, `resource_id=<contract uuid as text>`, ordered by `event_sequence` | `src/types/database.ts:17`, `supabase-contract-query-repository.ts:3163` |
| `hod.approve` logs event_type `CONTRACT_APPROVED`, **not** `CONTRACT_TRANSITIONED` → backfill must filter on `metadata ? 'to_status'`, never on event_type | `supabase-contract-query-repository.ts:6119` |
| Audit inserts are non-blocking; a transition can commit with no audit row → history gaps possible | `supabase-contract-query-repository.ts:3182` |
| `business_day_add(date,int)→date` and `business_day_diff(date,date)→int` are weekends-only, **date-granular** | migration `20260708120000` |
| App sets the deadline on `hod.approve`/`hod.bypass` as `business_day_add(today_utc, 7)` + `T23:59:59.000Z`; TAT policy = 7 business days | `supabase-contract-query-repository.ts:3048-3094`, `src/core/constants/contracts.ts:349` |
| `enforce_contract_tat_mutability()` (BEFORE UPDATE trigger) blocks all `tat_deadline_at` changes unless `OLD.tat_deadline_at IS NULL AND OLD.status='HOD_PENDING' AND NEW.status IN ('UNDER_REVIEW','LEGAL_PENDING')`; also blocks all `tat_breached_at` changes. It only validates — never assigns to NEW | `remote_schema.sql:2152` |
| `LEGAL_PENDING` is not a valid status (absent from `contracts_status_check`) — obsolete reference in the mutability function | `remote_schema.sql:2786` |
| The stored `tat_deadline_at` is trustworthy: the mutability trigger has blocked every change since first HOD approval | trigger above |
| UI: the "TAT Breached" **flag** is deadline-driven (`is_tat_breached`: `now > tat_deadline_at`, non-terminal). The "Overdue by X days" **number** and aging color chips are `aging_business_days`-driven | `remote_schema.sql:2812`, `DashboardClient.tsx:115`, `RepositoryWorkspace.tsx:151` |

### Known limitation (accepted)

Pausing the deadline correctly pauses the *breach flag*, but "Overdue by X days" and aging chips remain aging-driven and will not account for pauses. Out of scope per the aging constraint; flagged here so it is a decision, not a surprise.

## 3. Decisions (user-confirmed)

1. **Architecture:** Option B — new `contracts.tat_paused_at timestamptz` column; DB triggers own the stopwatch.
2. **Trigger structure:** single stopwatch function (pause + resume in one `BEFORE UPDATE` trigger) + rewritten status-based mutability permit. (Approach 1)
3. **Resume semantics:** the trigger **overrides** any fresh deadline the app sends; the clock starts at first HOD approval and nothing ever resets it.
4. **Backfill math:** Option A — shift the stored deadline by the summed pause windows. Option B (full reconstruction from first UNDER_REVIEW entry + 7) is computed **read-only** as a cross-check report column.
5. **Backfill scope:** **all** contracts with `tat_deadline_at IS NOT NULL`, terminal statuses included.
6. **Gap handling:** if the audit chain is broken or doesn't end at the current status → **skip that contract and report it**; never write from incomplete history.
7. Same-day pause+resume ⇒ shift of 0 (inherent to the date-granular business-day functions; consistent with the rest of the system).

## 4. Deliverable 1 — Migration

File: `supabase/migrations/20260722<hhmmss>_add_tat_stopwatch.sql` (+ matching rollback in `supabase/rollbacks/`). Single transaction. **Written, not applied.**

### 4.1 Column

```sql
ALTER TABLE public.contracts ADD COLUMN tat_paused_at timestamptz;
```

Nullable, no default. `NULL` = clock running (or never started). Non-null = clock paused at that instant.

### 4.2 `handle_contract_tat_stopwatch()` + trigger

`BEFORE UPDATE ON public.contracts FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)`, trigger name `contract_tat_stopwatch_trigger`. Mutually exclusive branches:

- **Pause** — `OLD.status = 'UNDER_REVIEW' AND NEW.status <> 'UNDER_REVIEW' AND OLD.tat_deadline_at IS NOT NULL`:
  `NEW.tat_paused_at := CURRENT_TIMESTAMP;`
- **Resume** — `NEW.status = 'UNDER_REVIEW' AND OLD.status <> 'UNDER_REVIEW' AND OLD.tat_paused_at IS NOT NULL AND OLD.tat_deadline_at IS NOT NULL`:
  ```
  pause_days := business_day_diff((OLD.tat_paused_at AT TIME ZONE 'UTC')::date,
                                  (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date);
  NEW.tat_deadline_at := shifted deadline  -- business_day_add(old deadline's UTC date, pause_days)
                                           -- re-assembled with the old deadline's original UTC
                                           -- time-of-day (preserves the 23:59:59Z convention)
  NEW.tat_paused_at := NULL;
  ```
  This **discards** whatever `tat_deadline_at` the app sent in the same UPDATE.
- **Never-reset guard** — entering `UNDER_REVIEW` with `OLD.tat_deadline_at IS NOT NULL` but `OLD.tat_paused_at IS NULL` (e.g., a contract the backfill skipped): `NEW.tat_deadline_at := OLD.tat_deadline_at;` — keeps the existing deadline, discards the app's fresh 7-day value. Enforces "nothing ever resets the clock".
- **First HOD approval** — `OLD.tat_deadline_at IS NULL`: no action; the app's fresh deadline passes through.

Function style follows existing conventions: `LANGUAGE plpgsql`, `SET search_path TO 'public'`, owner `postgres`, `GRANT ALL ... TO anon, authenticated, service_role`.

### 4.3 Rewritten `enforce_contract_tat_mutability()`

- `tat_breached_at` block: **unchanged**.
- `tat_deadline_at` permit becomes status-based:
  ```
  allowed iff NEW.status = 'UNDER_REVIEW'
          AND OLD.status IS DISTINCT FROM 'UNDER_REVIEW'
          AND NEW.tat_deadline_at IS NOT NULL
  ```
  Covers first approval *and* resume; fixes the reroute crash; drops the obsolete `LEGAL_PENDING` branch and the `OLD.tat_deadline_at IS NULL` requirement.
- The function still only validates (never assigns), so trigger firing order between the stopwatch and mutability triggers is irrelevant. (Alphabetically `contract_tat_stopwatch_trigger` fires before `enforce_contract_tat_mutability_trigger` anyway, so the mutability check sees the stopwatch's final NEW values.)

### 4.4 Rollback file

Drops `contract_tat_stopwatch_trigger` + function, restores the original `enforce_contract_tat_mutability()` body verbatim, drops the `tat_paused_at` column.

## 5. Deliverable 2 — Backfill (one-time script)

File: `supabase/backfills/20260722_tat_stopwatch_backfill.sql`. Single `BEGIN/COMMIT`. **Written, not run.**

1. **Candidates:** every contract with `tat_deadline_at IS NOT NULL` (terminal included, per decision 5).
2. **Replay source:** `audit_logs` rows with `resource_type = 'contract'` and `metadata ? 'to_status'`, cast `resource_id::uuid`, drop no-ops (`from_status = to_status` or `from_status` absent on the `system.initial_route` row is tolerated as chain start), ordered by `event_sequence`.
3. **Chain guard (decision 6):** per contract, every row's `from_status` must equal the previous row's `to_status`, and the final `to_status` must equal `contracts.status`. Violation ⇒ contract skipped, listed in the report with reason (`CHAIN_BROKEN` / `FINAL_STATUS_MISMATCH` / `NO_TRANSITIONS`).
4. **Pause windows:** each `from_status='UNDER_REVIEW'` row opens a window at its `created_at`; the next `to_status='UNDER_REVIEW'` row closes it. Closed windows contribute `business_day_diff(leave_utc_date, reenter_utc_date)`; an open window (contract currently outside `UNDER_REVIEW`) contributes nothing to the shift but sets `tat_paused_at :=` its leave timestamp.
5. **Write (Option A):** `tat_deadline_at := business_day_add(stored deadline's UTC date, Σ closed windows)` re-assembled with the original time-of-day; `tat_paused_at` as computed (NULL when currently `UNDER_REVIEW`).
6. **Cross-check (Option B, read-only):** report column `reconstructed_deadline = business_day_add(first UNDER_REVIEW entry's UTC date, 7 + Σ closed windows)`, with a `matches_option_a` boolean. Never written to the table.
7. **Mechanics:** `ALTER TABLE public.contracts DISABLE TRIGGER enforce_contract_tat_mutability_trigger;` before the UPDATE and re-enable after, inside the same transaction (the UPDATE doesn't change `status`, so the stopwatch trigger's WHEN clause keeps it inert; `tat_breached_at` and `row_version` untouched).
8. **Report output:** (a) updated contracts with before/after deadline, shift days, and new `tat_paused_at`; (b) skipped contracts with reason; (c) Option B disagreements; (d) summary counts.

## 6. Testing / verification plan

- Migration and backfill are delivered as files only; review precedes any application.
- The backfill script's report SELECTs serve as the primary verification artifact (before/after, skip reasons, Option A vs B cross-check).
- Post-application (future step, explicitly out of scope now): exercise pause (`legal.set.on_hold`), resume, reroute → re-approve (crash fixed, deadline preserved+shifted), first approval, and confirm `aging_business_days` output is byte-identical for a sample contract.

## 7. Out of scope

- Any change to `aging_business_days`, `contracts_repository_view`, `hod_approved_at`, or `tat_breached_at` logic.
- App/TypeScript changes (the DB trigger overriding the app's fresh deadline makes them unnecessary).
- Making "Overdue by X days" / aging chips pause-aware (known limitation, §2).
- Applying either script to any environment.
