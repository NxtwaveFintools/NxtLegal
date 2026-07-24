# TAT Stopwatch — Design Spec

**Date:** 2026-07-24
**Status:** For review
**Scope:** SQL migration + one-time backfill + pgTAP tests + one app-code change.
**Application guarantee:** Nothing in this work is applied to any database. All SQL is delivered as files to be reviewed and run later in a controlled environment. This session performed **read-only** live-DB inspection only.

---

## 1. Problem

`contracts.tat_deadline_at` (the SLA clock) currently runs continuously from HOD approval. The business rule is that the clock must run **only while a contract is in `UNDER_REVIEW`**:

- **Pause** when a contract leaves `UNDER_REVIEW`.
- **Resume** when it re-enters `UNDER_REVIEW`, pushing the deadline forward by the business days it spent paused.
- The clock is set once (at first HOD approval / bypass) and is **never reset** thereafter.

A live bug is fixed as a side effect: after `legal.query.reroute` (`UNDER_REVIEW → HOD_PENDING`), the re-approval crashes because `enforce_contract_tat_mutability()` only permits setting `tat_deadline_at` when `OLD.tat_deadline_at IS NULL`.

### Hard constraint

`aging_business_days` (computed in `contracts_repository_view` as `business_day_diff(hod_approved_at, now)`) **is not changed in any way**. It remains a total measure of time since HOD approval. This is an accepted, user-confirmed constraint — see the limitation in §7.

---

## 2. Verified facts (evidence basis)

> **Staleness warning.** The committed dump `supabase/migrations/20260511113928_remote_schema.sql` is from **May 2026** and is stale: the July migration `20260708120000_drop_holidays_weekends_only_tat.sql` rewrote the business-day engine. Every fact below reflects the **layered** current state (May dump + later migrations + a live read-only probe on 2026-07-24), not the May dump alone.

| Fact | Source |
|---|---|
| `business_day_add(date,int)→date` and `business_day_diff(date,date)→int` are **weekends-only, date-granular** (holidays table dropped). | `20260708120000_drop_holidays_weekends_only_tat.sql` |
| `contracts.status` is `text` with 13 valid values; **`LEGAL_PENDING` is not one of them** (obsolete reference in the current mutability function). `tat_paused_at` does **not** exist yet. | `remote_schema.sql:2786`, live probe |
| Status transitions are recorded in `audit_logs.metadata` jsonb as `from_status` / `to_status` (**not** columns). `resource_type='contract'`, `resource_id` = contract UUID as text, ordered by `event_sequence` (bigint identity). | `remote_schema.sql:2485`, live rows |
| Some flows emit `event_type='CONTRACT_TRANSITIONED'`; others differ. Backfill must filter on `metadata ? 'to_status'`, never on `event_type`. | live rows |
| Audit inserts are non-blocking → history can have gaps. | `supabase-contract-query-repository.ts:3163` |
| App sets `tat_deadline_at = business_day_add(today_utc, 7)` + `T23:59:59.000Z` on **every** `hod.approve`/`hod.bypass`. `hod.bypass` sets `hod_approved_at = NULL`. TAT policy = 7 business days. | `supabase-contract-query-repository.ts:3048-3120`, `constants/contracts.ts` |
| `enforce_contract_tat_mutability()` permits a `tat_deadline_at` change only when `OLD.tat_deadline_at IS NULL AND OLD.status='HOD_PENDING' AND NEW.status IN ('UNDER_REVIEW','LEGAL_PENDING')`. It only validates; it never assigns. | `remote_schema.sql:2152` |
| `contracts_repository_view`: `aging_business_days` uses `hod_approved_at` only (not `tat_deadline_at`); `is_tat_breached = now > tat_deadline_at` (deadline-driven); the view does **not** select `tat_paused_at`. | `remote_schema.sql:2794` |
| Trigger firing order: `contract_tat_stopwatch_trigger` (c…) fires before `enforce_contract_tat_mutability_trigger` (e…), so mutability validates the stopwatch's final `NEW` values. | alphabetical trigger order |

### Live data snapshot (2026-07-24, production, read-only)

- 100 contracts; **89 have `tat_deadline_at`**; 0 have `tat_breached_at` stamped; 0 soft-deleted.
- 400 contract transition rows in `audit_logs`.
- Of the 89 deadline contracts: **36** are currently `UNDER_REVIEW` (clock running — no backfill change); **35** are currently paused **and resolvable** from the audit log (a logged exit from `UNDER_REVIEW` exists); **18** are currently paused but **unresolvable** (no usable exit event) and will be skipped + reported.
- **15** deadline contracts have `hod_approved_at IS NULL` (they were `hod.bypass`ed) — so any "HOD-approval-anchored" reconstruction is impossible for them. This is why the backfill anchors on the **exit event**, not on `hod_approved_at`.
- Every closed pause window in the current data spans **0 business days** (same-day transitions). The historical deadline **shift is 0** for all clean contracts today; the backfill's real value is stamping `tat_paused_at` on the currently-paused set so future resumes are credited correctly.

---

## 3. Decisions (user-confirmed)

1. **Architecture:** new `contracts.tat_paused_at timestamptz`; DB triggers own the stopwatch (Approach 1 — one stopwatch trigger + rewritten status-based mutability permit).
2. **Resume semantics:** the trigger **overrides** any fresh deadline the app sends. The clock starts at first HOD approval/bypass and is never reset.
3. **Breach flag becomes pause-aware** in the view (`is_tat_breached` = not breached while `tat_paused_at IS NOT NULL`). This is what makes the pause *visible*. Allowed because it does not touch `aging_business_days`.
4. **Aging split accepted:** `aging_business_days`, the "Overdue by X days" number, and aging color chips remain total-time-since-HOD-approval and do **not** pause. A paused contract can read "not breached" while its aging chip still shows overdue. Documented, intended.
5. **Backfill model (refined):** for each currently-paused deadline contract, set `tat_paused_at = timestamp of its *last* exit from `UNDER_REVIEW``. Keep the stored deadline as the base (no reconstruction of consumed time — business-day math is additive, so the trigger's resume-shift reproduces the correct remaining budget). Robust to bypass contracts (no `hod_approved_at`) and to multi-review histories. Option B (full reconstruction) is computed **read-only** as a cross-check report column, never written.
6. **Backfill scope:** all contracts with `tat_deadline_at IS NOT NULL`, terminal statuses included. Unresolvable/skipped contracts are reported, never written from incomplete history.
7. **App change (DB + app resume-path):** on `hod.approve`/`hod.bypass` where a deadline already exists (re-approval), the app stops resending `today+7`; first approval still sets it. Makes the "never reset" intent explicit instead of relying on the trigger to silently discard the app's value.
8. **Tests:** executable pgTAP, committed but **not run** here.

---

## 4. Deliverable 1 — Migration

File: `supabase/migrations/20260724120000_add_tat_stopwatch.sql`. Single transaction. **Written, not applied.** Matching rollback in `supabase/rollbacks/`.

### 4.1 Column
```sql
ALTER TABLE public.contracts ADD COLUMN tat_paused_at timestamptz;
```
Nullable, no default. `NULL` = clock running (or never started); non-null = clock paused at that instant.

### 4.2 `handle_contract_tat_stopwatch()` + trigger
`BEFORE UPDATE OF status ON public.contracts FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)`, trigger name `contract_tat_stopwatch_trigger`. Mutually exclusive branches (all guarded by `OLD.tat_deadline_at IS NOT NULL` — a contract with no deadline has no clock):

- **Pause** — `OLD.status = 'UNDER_REVIEW' AND NEW.status <> 'UNDER_REVIEW'`:
  `NEW.tat_paused_at := CURRENT_TIMESTAMP;`
- **Resume** — `NEW.status = 'UNDER_REVIEW' AND OLD.status <> 'UNDER_REVIEW' AND OLD.tat_paused_at IS NOT NULL`:
  ```
  pause_days := business_day_diff((OLD.tat_paused_at AT TIME ZONE 'UTC')::date,
                                  (CURRENT_TIMESTAMP  AT TIME ZONE 'UTC')::date);
  NEW.tat_deadline_at := business_day_add((OLD.tat_deadline_at AT TIME ZONE 'UTC')::date, pause_days)
                         re-assembled with OLD.tat_deadline_at's original UTC time-of-day (preserves 23:59:59Z);
  NEW.tat_paused_at   := NULL;
  ```
  Bases the shift on **`OLD.tat_deadline_at`**, discarding whatever the app sent in the same UPDATE.
- **Never-reset guard** — entering `UNDER_REVIEW` with `OLD.tat_deadline_at IS NOT NULL` but `OLD.tat_paused_at IS NULL` (e.g. a contract the backfill skipped): `NEW.tat_deadline_at := OLD.tat_deadline_at;` — keeps the existing deadline, discards the app's fresh 7-day value.
- **First approval** — `OLD.tat_deadline_at IS NULL`: no action; the app's fresh deadline passes through.

Convention: `LANGUAGE plpgsql`, `SET search_path TO 'public'`, owner `postgres`, `GRANT ALL … TO anon, authenticated, service_role`.

### 4.3 Rewritten `enforce_contract_tat_mutability()`
- `tat_breached_at` block: **unchanged**.
- `tat_deadline_at` permit becomes status-based:
  ```
  allowed iff NEW.status = 'UNDER_REVIEW'
          AND OLD.status IS DISTINCT FROM 'UNDER_REVIEW'
          AND NEW.tat_deadline_at IS NOT NULL
  ```
  Covers first approval **and** resume; fixes the reroute crash; drops the obsolete `LEGAL_PENDING` branch and the `OLD.tat_deadline_at IS NULL` requirement. Still validate-only (never assigns), so firing order is irrelevant to correctness.

### 4.4 `contracts_repository_view` — pause-aware breach flag
Recreate the view **verbatim except** `is_tat_breached`, which gains `AND tat_paused_at IS NULL`:
```sql
CASE WHEN tat_deadline_at IS NOT NULL AND tat_paused_at IS NULL
          AND CURRENT_TIMESTAMP > tat_deadline_at
          AND status <> ALL (ARRAY['COMPLETED','EXECUTED','REJECTED'])
     THEN true ELSE false END AS is_tat_breached
```
`aging_business_days` and `near_breach` expressions are copied **byte-for-byte**. (Consider whether `near_breach` should also gate on `tat_paused_at IS NULL` — default: leave unchanged to minimize surface; call out in review.)

---

## 5. Deliverable 2 — App change (resume-path)

File: `src/core/infra/repositories/supabase-contract-query-repository.ts`, `hod.approve`/`hod.bypass` branch (~L3048–3120).

- **First approval** (`OLD.tat_deadline_at` / `contract.tatDeadlineAt IS NULL`): unchanged — compute and set `tat_deadline_at = business_day_add(today,7)`.
- **Re-approval** (deadline already exists): do **not** include `tat_deadline_at` in the update payload. The pause trigger stamped `tat_paused_at` on the reroute; the resume trigger shifts the deadline. The app no longer sends a competing `today+7` that the trigger has to discard.

This is behaviour-preserving given the trigger (the trigger already discards the app value), but makes intent explicit and removes a redundant `business_day_add` RPC on re-approval. No change to `hod_approved_at` handling.

---

## 6. Deliverable 3 — Backfill (one-time script)

File: `supabase/backfills/20260724_tat_stopwatch_backfill.sql`. Single `BEGIN/COMMIT`. **Written, not run.**

1. **Candidates:** every contract with `tat_deadline_at IS NOT NULL` (terminal included).
2. **Currently `UNDER_REVIEW`:** clock running → `tat_paused_at` stays `NULL`, deadline untouched. No-op.
3. **Currently paused (status ≠ `UNDER_REVIEW`):** find the **last** `audit_logs` row with `metadata->>'from_status' = 'UNDER_REVIEW'` (resource_type='contract', ordered by `event_sequence`). If found → `tat_paused_at := that row's created_at`; deadline untouched (stored `approval+7` is the correct base). If **not** found → **skip + report** (`reason = NO_EXIT_EVENT`).
4. **Mechanics:** `ALTER TABLE public.contracts DISABLE TRIGGER enforce_contract_tat_mutability_trigger;` around the UPDATE, re-enabled in the same transaction. The UPDATE does not change `status`, so the stopwatch trigger's `WHEN` clause keeps it inert; `tat_deadline_at`, `tat_breached_at`, `row_version` are untouched.
5. **Option B cross-check (read-only report column):** `reconstructed_deadline = business_day_add(first UNDER_REVIEW entry's UTC date, 7 + Σ closed pause windows)`, plus `matches_stored_deadline` boolean. `RAISE NOTICE` on any drift. Never written.
6. **Report:** (a) updated contracts (id, status, new `tat_paused_at`); (b) skipped contracts + reason; (c) Option B disagreements; (d) summary counts. Expected on today's data: ~35 stamped, ~18 skipped, 36 no-op, 0 deadline shifts.

---

## 7. Deliverable 4 — Tests (pgTAP, unrun)

File: `supabase/tests/tat_stopwatch_test.sql`. Assertions (run later in a disposable DB):

1. **Pause:** `UNDER_REVIEW → ON_HOLD` sets `tat_paused_at`, leaves `tat_deadline_at` unchanged.
2. **Resume, 0-day:** same-day `ON_HOLD → UNDER_REVIEW` clears `tat_paused_at`, deadline unchanged.
3. **Resume, N-day:** paused N business days → deadline shifts by exactly N business days (`business_day_add`), `tat_paused_at` cleared.
4. **Reroute → re-approve:** `UNDER_REVIEW → HOD_PENDING → UNDER_REVIEW` no longer raises; deadline preserved + shifted; the app's competing `today+7` is discarded.
5. **First approval:** `HOD_PENDING → UNDER_REVIEW` with `OLD.tat_deadline_at IS NULL` lets the app's deadline pass through.
6. **Never-reset guard:** entering `UNDER_REVIEW` with a deadline but `tat_paused_at IS NULL` keeps the old deadline.
7. **Mutability still guards:** direct `tat_breached_at` change still raises; out-of-band `tat_deadline_at` change (not an into-`UNDER_REVIEW` transition) still raises.
8. **Breach flag pause-aware:** a past-deadline paused contract reports `is_tat_breached = false`; the same contract un-paused reports `true`.
9. **Aging unchanged:** `aging_business_days` output is byte-identical before/after for a fixed sample (guards the hard constraint).

---

## 8. Rollback

File: `supabase/rollbacks/20260724120000_add_tat_stopwatch_rollback.sql`. Drops `contract_tat_stopwatch_trigger` + function; restores `enforce_contract_tat_mutability()` to its current body verbatim; recreates `contracts_repository_view` with the original `is_tat_breached`; drops `tat_paused_at`. (Backfill data in `tat_paused_at` is dropped with the column — acceptable, it is re-derivable from the audit log.)

---

## 9. Feasibility verdict

- **Forward stopwatch + mutability fix + pause-aware breach flag:** fully feasible and clean; also fixes a live crash. This is the substantive fix.
- **Backfill:** feasible for ~35/89 paused contracts via the last-exit stamp; ~18 skipped (incomplete audit history) and reported for manual review; 36 need nothing. Zero deadline shifts on today's data (all pause windows are same-day).
- **Not fixable at the DB layer (accepted):** the aging number/chips staying total (the split in §3.4), because the constraint forbids changing `aging_business_days`. If the business later wants chips to pause too, that is a separate, larger change (dashboard counts, sorting, exports all read aging).

---

## 10. Out of scope

- Any change to `aging_business_days`, `hod_approved_at`, or `tat_breached_at` logic.
- Making "Overdue by X days" / aging chips pause-aware (the accepted limitation, §9).
- Applying the migration, backfill, or tests to any environment.
- Rewriting the `18` unresolvable contracts from incomplete history.
