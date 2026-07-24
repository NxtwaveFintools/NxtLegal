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
- Of the 89 deadline contracts, under the **safe write-gate** (§6): **36** are currently `UNDER_REVIEW` (no-op); **28** are currently paused **and writable** (complete audit chain whose reconstruction matches the stored deadline); **25** are skipped + reported (**22** chain-broken, **3** no exit event); **0** reconstruction mismatches.
- **15** deadline contracts have `hod_approved_at IS NULL` (they were `hod.bypass`ed) — so any "HOD-approval-anchored" reconstruction is impossible for them. The backfill therefore anchors on **audit exit/entry events**, not on `hod_approved_at`.
- Every closed pause window in the current data spans **0 business days** (same-day transitions), so `Σ closed windows = 0` for every writable contract and the deadline **shift is 0** today. This is an empirical property of current rows, **not** a structural guarantee — the write-gate (§6.3) enforces it so a future non-zero window can never be silently under-credited. The backfill's real value is stamping `tat_paused_at` so future resumes are credited correctly.
- **24** contracts currently render `is_tat_breached = true` while paused (SIGNING 15, VOID 5, OFFLINE_EXECUTION 2, PENDING_WITH_EXTERNAL_STAKEHOLDERS 1, ON_HOLD 1). See the day-one blast-radius note in §11.

---

## 3. Decisions (user-confirmed)

1. **Architecture:** new `contracts.tat_paused_at timestamptz`; DB triggers own the stopwatch (Approach 1 — one stopwatch trigger + rewritten status-based mutability permit).
2. **Resume semantics:** the trigger **overrides** any fresh deadline the app sends. The clock starts at first HOD approval/bypass and is never reset.
3. **Breach flag becomes pause-aware** in the view (`is_tat_breached` = not breached while `tat_paused_at IS NOT NULL`). This is what makes the pause *visible*. Allowed because it does not touch `aging_business_days`.
4. **Aging split accepted:** `aging_business_days`, the "Overdue by X days" number, and aging color chips remain total-time-since-HOD-approval and do **not** pause. A paused contract can read "not breached" while its aging chip still shows overdue. Documented, intended.
5. **Backfill model (refined + gated):** for each currently-paused deadline contract, set `tat_paused_at = timestamp of its *last* exit from `UNDER_REVIEW``, keeping the stored deadline as the base — **but only when the Option B reconstruction matches the stored deadline** (which holds iff `Σ closed pause windows = 0` and the audit chain is complete). Otherwise skip + report. The write-gate is not optional: keeping the stored deadline as the base is only correct when `Σ closed windows = 0`; the gate makes that assumption self-enforcing rather than a property we hope current data has. Bypass contracts (no `hod_approved_at`) are still handled because the anchor is the audit entry event, not `hod_approved_at`.
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
  pause_days := GREATEST(business_day_diff((OLD.tat_paused_at AT TIME ZONE 'UTC')::date,
                                           (CURRENT_TIMESTAMP  AT TIME ZONE 'UTC')::date), 0);
  -- Reassemble on the ORIGINAL time-of-day (all live deadlines are 23:59:59Z);
  -- a naive ::date cast would silently move breach detection by ~a day.
  NEW.tat_deadline_at := (
      business_day_add((OLD.tat_deadline_at AT TIME ZONE 'UTC')::date, pause_days)
      + (OLD.tat_deadline_at AT TIME ZONE 'UTC')::time
  ) AT TIME ZONE 'UTC';
  NEW.tat_paused_at   := NULL;
  ```
  Bases the shift on **`OLD.tat_deadline_at`**, discarding whatever the app sent in the same UPDATE. `pause_days` is clamped ≥ 0 so clock skew can never move a deadline backward.
- **Never-reset guard** — entering `UNDER_REVIEW` with `OLD.tat_deadline_at IS NOT NULL` but `OLD.tat_paused_at IS NULL` (e.g. a contract the backfill skipped): `NEW.tat_deadline_at := OLD.tat_deadline_at;` — keeps the existing deadline, discards the app's fresh 7-day value.
- **First approval** — `OLD.tat_deadline_at IS NULL`: no deadline action; also defensively `NEW.tat_paused_at := NULL` so an `UNDER_REVIEW` row can never carry a stale pause stamp.

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
**Verified (2026-07-24):** the live view is byte-for-byte the May-dump definition (20 columns; **no** `legal_*` columns — those live only in the app's optional select, which falls back to a legacy select). No out-of-band drift, so recreating from the May def is safe. `CREATE OR REPLACE VIEW` keeps the same column list/order (only the `is_tat_breached` expression body changes), preserving `WITH (security_invoker='true')`, ownership, and grants. `tat_paused_at` is **referenced** in the expression but **not** added as a selected column (avoids a column-order change).

`aging_business_days` is copied **byte-for-byte** (hard constraint). **Recommendation:** also gate `near_breach` on `tat_paused_at IS NULL` — otherwise a paused contract can render a "near breach" chip while `is_tat_breached` is false, an internal inconsistency. Final call in review (see §11).

---

## 5. Deliverable 2 — App change (resume-path)

File: `src/core/infra/repositories/supabase-contract-query-repository.ts`, `hod.approve`/`hod.bypass` branch (~L3048–3120).

- **First approval** (`OLD.tat_deadline_at` / `contract.tatDeadlineAt IS NULL`): unchanged — compute and set `tat_deadline_at = business_day_add(today,7)`.
- **Re-approval** (deadline already exists): do **not** include `tat_deadline_at` in the update payload. The pause trigger stamped `tat_paused_at` on the reroute; the resume trigger shifts the deadline. The app no longer sends a competing `today+7` that the trigger has to discard.

This is behaviour-preserving given the trigger (the trigger already discards the app value), but makes intent explicit and removes a redundant `business_day_add` RPC on re-approval. No change to `hod_approved_at` handling.

**Deployment order (critical if split into a separate PR):** the migration must ship **before or with** the app change — never app-first. App-first means re-approval stops sending a deadline while the resume trigger does not yet exist, so the pause is never credited and the deadline stays stale. Ship together, or migration first.

**Observed, out of scope:** the app still sets `hod_approved_at = now()` on every `hod.approve` (and `= NULL` on `hod.bypass`) on re-approval, so `aging_business_days` restarts (or goes NULL) on re-approval. Pre-existing behaviour, untouched here; flagged so it is not mistaken for a regression.

---

## 6. Deliverable 3 — Backfill (one-time script)

File: `supabase/backfills/20260724_tat_stopwatch_backfill.sql`. Single `BEGIN/COMMIT`. **Written, not run.**

1. **Candidates:** every contract with `tat_deadline_at IS NOT NULL AND deleted_at IS NULL` (terminal statuses included; soft-deleted excluded).
2. **Currently `UNDER_REVIEW`:** clock running → `tat_paused_at` stays `NULL`, deadline untouched. No-op.
3. **Currently paused (status ≠ `UNDER_REVIEW`) — the write-gate:** using audit rows (`resource_type='contract'`, `metadata ? 'to_status'`, ordered by `event_sequence`, tie-broken by `created_at,id`):
   - `last_exit` = last row with `from_status='UNDER_REVIEW' AND to_status<>'UNDER_REVIEW'`; if none → **skip** (`NO_EXIT_EVENT`).
   - `first_entry` = first row with `to_status='UNDER_REVIEW'`; if none → **skip** (`NO_ENTRY_EVENT`).
   - **Chain-complete check:** every row's `from_status` must equal the previous row's `to_status`; else → **skip** (`CHAIN_BROKEN`).
   - `Σ_closed` = sum of `business_day_diff(leave_date, reenter_date)` over closed windows; `reconstructed = business_day_add((first_entry.created_at AT TIME ZONE 'UTC')::date, 7 + Σ_closed)`.
   - **Write iff** `reconstructed = (tat_deadline_at AT TIME ZONE 'UTC')::date`; then `tat_paused_at := last_exit.created_at`, deadline untouched. Else → **skip** (`RECONSTRUCTION_MISMATCH`) for manual review (a non-zero closed window the "keep stored deadline" base cannot represent).
4. **Mechanics — no trigger disabling.** The UPDATE writes **only** `tat_paused_at`, which neither trigger guards (`enforce_contract_tat_mutability` guards only `tat_deadline_at`/`tat_breached_at`; the stopwatch trigger is `UPDATE OF status` and never fires here). **Do not** `DISABLE TRIGGER`: that is table-level DDL, not transaction-local — it drops the mutability guard for *every* concurrent writer and takes an `ACCESS EXCLUSIVE` lock. The existing `update_contracts_updated_at` trigger will bump `updated_at` on the ~28 written rows; this is accepted (do **not** disable it either, same DDL risk).
5. **Option B is the gate, not just a report:** `reconstructed_deadline` + `matches_stored_deadline` are computed for every candidate and drive the write decision in step 3, and are emitted in the report. `RAISE NOTICE` on every mismatch.
6. **Idempotent:** re-running yields the same result (writable rows recompute the same `last_exit`; resumed rows are back to `UNDER_REVIEW` → no-op). Safe to run twice.
7. **Report:** (a) written contracts (id, status, new `tat_paused_at`); (b) skipped + reason; (c) mismatches; (d) summary counts. **Expected on today's data: 28 written, 25 skipped (22 `CHAIN_BROKEN`, 3 `NO_EXIT_EVENT`), 36 no-op, 0 deadline shifts, 0 mismatches.**

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
10. **Time-of-day preserved (regression trap):** a deadline of `...T23:59:59Z` resumed after an N-day pause is still `...T23:59:59Z` on the shifted date — never `T00:00:00Z`. This is the naive-`::date`-cast trap; all live deadlines are `23:59:59Z` so a regression would be uniform and invisible without this assertion.
11. **`pause_days` clamp:** a `tat_paused_at` in the future (simulated clock skew) yields a 0-day shift, never a backward move.
12. **Backfill gate:** a synthetic contract with a non-zero closed window is **skipped** (`RECONSTRUCTION_MISMATCH`), not written; a clean `Σ=0` contract is written.
13. **Backfill touches only `tat_paused_at`:** the backfill UPDATE succeeds with `enforce_contract_tat_mutability_trigger` **enabled** (proves no `DISABLE` is needed).

---

## 8. Rollback

File: `supabase/rollbacks/20260724120000_add_tat_stopwatch_rollback.sql`. Drops `contract_tat_stopwatch_trigger` + function; restores `enforce_contract_tat_mutability()` to its current body verbatim; recreates `contracts_repository_view` with the original `is_tat_breached`; drops `tat_paused_at`. (Backfill data in `tat_paused_at` is dropped with the column — acceptable, it is re-derivable from the audit log.)

---

## 9. Feasibility verdict

- **Forward stopwatch + mutability fix + pause-aware breach flag:** fully feasible and clean; also fixes a live crash. This is the substantive fix.
- **Backfill:** feasible for **28/89** paused contracts under the safe write-gate; **25** skipped (22 chain-broken, 3 no exit event) and reported for manual review; 36 need nothing. Zero deadline shifts on today's data (all pause windows same-day). The gate guarantees no contract is ever silently under-credited.
- **Not fixable at the DB layer (accepted):** the aging number/chips staying total (the split in §3.4), because the constraint forbids changing `aging_business_days`. If the business later wants chips to pause too, that is a separate, larger change (dashboard counts, sorting, exports all read aging).

---

## 11. Edge cases & hardening

Ordered by risk. The first item is the load-bearing invariant; everything below it is preserve-correctness hardening.

### A. Correctness invariants (must hold)

1. **Backfill base assumption — `Σ closed windows = 0`.** "Keep the stored deadline as the base" is correct **only** when no closed pause window contributed business days. The write-gate (§6.3) enforces this by writing only when the full-chain reconstruction equals the stored deadline. Today all 28 writable contracts satisfy it; a future non-zero window is skipped for manual review, never silently under-credited. **This is the one edge case that would produce a wrong-but-plausible deadline in prod; the gate is mandatory.**
2. **Resume shift reads `OLD.tat_deadline_at`, not `NEW`.** Reading `NEW` would make the override a no-op (the app's `today+7` would win). Tested in §7.4.
3. **Time-of-day round-trips `23:59:59Z`.** The reassembly formula (§4.2) preserves the original UTC time; a naive `::date` cast moves breach detection ~1 day and would be uniform/invisible. Tested in §7.10.
4. **Additivity.** Incremental (trigger, one shift per resume) equals batch (Σ then one shift) because `business_day_add` always lands on a business day and is additive over non-negative ints. This is why per-resume shifting and the backfill agree.
5. **Post-backfill invariant:** `tat_paused_at IS NOT NULL ⇒ status <> 'UNDER_REVIEW'`. The backfill keys off `contracts.status` (authoritative), never the audit log, so it can never stamp an active contract. Not enforced by a CHECK constraint (existing rows / transient states), but relied upon.

### B. Trigger edge cases (all handled by the branch structure)

6. **Status change not involving `UNDER_REVIEW`** (e.g. `ON_HOLD → SIGNING`): neither branch matches; `tat_paused_at` is preserved (the contract stays paused from its original leave). Correct.
7. **Multi-hop pause** (`UNDER_REVIEW → ON_HOLD → SIGNING → … → UNDER_REVIEW`): `tat_paused_at` is set once on the first leave and cleared on the eventual return; the shift spans the whole out-of-review stretch. Correct.
8. **Reroute re-approval** (`UNDER_REVIEW → HOD_PENDING → UNDER_REVIEW`): pause branch stamps on the reroute, resume branch shifts on re-approval — so the guard is *not* hit here; the guard is only for backfill-skipped/legacy rows. This is the crash that is fixed.
9. **`UNDER_REVIEW → UNDER_REVIEW`** and same-value status writes: excluded by `WHEN (OLD.status IS DISTINCT FROM NEW.status)`.
10. **INSERT / first `UNDER_REVIEW` entry:** trigger is `UPDATE OF status`, so INSERT never fires it; first approval hits the `OLD.tat_deadline_at IS NULL` branch and passes the app value through.
11. **No other trigger interferes.** The five `contracts` triggers fire alphabetically: `contract_tat_stopwatch_trigger` (BEFORE, first) → `enforce_contract_department_tenant_match` (only on dept/tenant cols) → `enforce_contract_tat_mutability` (validates our final `NEW`) → `update_contracts_updated_at` → `validate_contract_current_document` (only on `current_document_id`). Verified against the schema; adding our `c…`-named trigger deliberately keeps it first.

### C. View / breach-flag blast radius (product-visible, day one)

12. **24 contracts flip on deploy.** Contracts past their deadline while paused currently show `is_tat_breached = true` (SIGNING 15, VOID 5, OFFLINE_EXECUTION 2, PENDING_WITH_EXTERNAL_STAKEHOLDERS 1, ON_HOLD 1). After backfill, the ~resolvable ones flip to **false**; the ~25 skipped-but-paused ones **stay true** → two paused contracts can disagree until their audit history is repaired. Expected, but visible — call out in release notes.
13. **Product question — should SIGNING / VOID / OFFLINE_EXECUTION ever show breached?** Today they can; after this change, paused+stamped ones will not. `is_tat_breached` still hard-excludes only `COMPLETED/EXECUTED/REJECTED`. Confirm the intended list with product; the change is defensible (clock paused) but is a behaviour change, not just a bug fix.
14. **`near_breach`** is likewise deadline-driven and (default recommendation) should also gate on `tat_paused_at IS NULL` for consistency (§4.4).

### D. Migration / ops

15. **Deployment order:** migration before/with the app change (§5). Never app-first.
16. **Locks:** `ADD COLUMN` (no default), `CREATE OR REPLACE FUNCTION/VIEW` are all fast on a 100-row table but take brief `ACCESS EXCLUSIVE` locks; run in a low-traffic window. Wrap the whole migration in one `BEGIN/COMMIT` so a partial failure rolls back.
17. **Rollback** drops `tat_paused_at` (losing backfilled stamps — re-derivable from the audit log) and restores the exact prior `is_tat_breached` and `enforce_contract_tat_mutability` bodies.

### E. Backfill / data

18. **`updated_at` bump:** the backfill trips `update_contracts_updated_at` on the ~28 written rows. Accepted; do not disable the trigger to avoid it.
19. **`resource_id` typing:** audit `resource_id` is `text`; filter `resource_type='contract'` and cast/compare against the contract UUID; tolerate non-castable rows by filtering them out.
20. **Soft-deleted / terminal contracts:** soft-deleted excluded from candidates; terminal statuses included (harmless — they will not resume; and it corrects VOID breach display).

---

## 12. Out of scope

- Any change to `aging_business_days`, `hod_approved_at`, or `tat_breached_at` logic.
- Making "Overdue by X days" / aging chips pause-aware (the accepted limitation, §9).
- Applying the migration, backfill, or tests to any environment.
- Rewriting the **25** skipped contracts from incomplete audit history (manual review).
