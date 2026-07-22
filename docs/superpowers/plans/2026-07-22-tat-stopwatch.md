# TAT Stopwatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write (never apply) the SQL migration that pauses/resumes the `tat_deadline_at` SLA clock via a new `contracts.tat_paused_at` column, plus a one-time backfill script that replays `audit_logs` history for existing contracts.

**Architecture:** A single `BEFORE UPDATE` stopwatch trigger on `public.contracts` owns pause/resume state mutation; the rewritten `enforce_contract_tat_mutability()` only validates with a status-based permit. The backfill replays `audit_logs` transition metadata per contract, guarded by a from→to chain check, and shifts the stored deadline (Option A) with a read-only reconstruction cross-check (Option B).

**Tech Stack:** PostgreSQL (Supabase), plpgsql triggers, existing `business_day_add(date,int)` / `business_day_diff(date,date)` weekends-only functions.

**Spec:** `docs/superpowers/specs/2026-07-22-tat-stopwatch-design.md`

**⛔ ABSOLUTE RULE — DO NOT APPLY:** No `supabase db push`, no `supabase migration up`, no psql execution, no MCP apply, no running any SQL against any database. Every task only writes files to disk and commits them to git. There is no runnable test step in this plan by design — verification is static (grep checks + review).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260722130000_add_tat_stopwatch.sql` | Create: column + stopwatch trigger + mutability rewrite (one transaction) |
| `supabase/rollbacks/20260722130000_add_tat_stopwatch_rollback.sql` | Create: exact inverse — drop trigger/function/column, restore original mutability function verbatim |
| `supabase/backfills/20260722_tat_stopwatch_backfill.sql` | Create: one-time replay/backfill script with reports (new `supabase/backfills/` directory) |

Verified context an engineer needs (all confirmed against this repo):

- `business_day_add("start_date" date, "days" integer) RETURNS date` and `business_day_diff("start_date" date, "end_date" date) RETURNS integer` exist, weekends-only, **date-granular** (`supabase/migrations/20260708120000_drop_holidays_weekends_only_tat.sql`).
- The current `enforce_contract_tat_mutability()` (to be replaced, original at `supabase/migrations/20260511113928_remote_schema.sql:2152`) permits `tat_deadline_at` changes only when `OLD.tat_deadline_at IS NULL AND OLD.status = 'HOD_PENDING' AND NEW.status IN ('UNDER_REVIEW','LEGAL_PENDING')` — that value-based rule is the reroute-crash bug. `LEGAL_PENDING` is not a valid status (absent from `contracts_status_check`).
- Triggers on `contracts` relevant to the backfill UPDATE: `enforce_contract_tat_mutability_trigger` (BEFORE UPDATE, all columns) and `update_contracts_updated_at` (BEFORE UPDATE, all columns). The other two (`enforce_contract_department_tenant_match_trigger`, `validate_contract_current_document_trigger`) are `UPDATE OF` other columns and cannot fire.
- Audit rows: `public.audit_logs` with `resource_type='contract'`, `resource_id = <contract uuid>::text`, `metadata->>'from_status'` / `metadata->>'to_status'`, global ordering column `event_sequence`. `hod.approve` is logged as `CONTRACT_APPROVED`, so **never filter on event_type** — filter on `metadata ? 'to_status'`.
- App deadline convention: `<date>T23:59:59.000Z` (UTC), 7 business days (`contractRepositoryTatPolicy.businessDays`).

---

### Task 1: Migration file

**Files:**
- Create: `supabase/migrations/20260722130000_add_tat_stopwatch.sql`

- [ ] **Step 1: Write the migration file with exactly this content**

```sql
-- ============================================================
-- Migration : TAT stopwatch — pause/resume tat_deadline_at
-- Adds      : contracts.tat_paused_at (timestamptz, nullable)
-- Creates   : handle_contract_tat_stopwatch() + contract_tat_stopwatch_trigger
-- Rewrites  : enforce_contract_tat_mutability() — status-based permit;
--             fixes the reroute re-approve crash; drops the obsolete
--             LEGAL_PENDING reference.
-- Rule      : the SLA clock starts at the first HOD approval, runs only
--             while status = 'UNDER_REVIEW', and nothing ever resets it.
-- Untouched : aging_business_days, contracts_repository_view,
--             hod_approved_at, tat_breached_at handling.
-- Date      : 2026-07-22
-- Spec      : docs/superpowers/specs/2026-07-22-tat-stopwatch-design.md
-- Idempotent: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE FUNCTION;
--             DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- ============================================================

ALTER TABLE "public"."contracts"
  ADD COLUMN IF NOT EXISTS "tat_paused_at" timestamp with time zone;

COMMENT ON COLUMN "public"."contracts"."tat_paused_at" IS
  'TAT stopwatch: set to the instant the contract left UNDER_REVIEW (clock paused). NULL while the clock is running or before the first HOD approval.';


CREATE OR REPLACE FUNCTION "public"."handle_contract_tat_stopwatch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  pause_days INTEGER;
  old_deadline_utc TIMESTAMP;  -- OLD.tat_deadline_at as UTC wall-clock
  shifted_date DATE;
BEGIN
  -- Trigger WHEN clause guarantees OLD.status IS DISTINCT FROM NEW.status.

  -- Branch 1: PAUSE — leaving UNDER_REVIEW with a running clock.
  IF OLD.status = 'UNDER_REVIEW'
     AND NEW.status <> 'UNDER_REVIEW'
     AND OLD.tat_deadline_at IS NOT NULL THEN
    NEW.tat_paused_at := CURRENT_TIMESTAMP;
    RETURN NEW;
  END IF;

  -- Branch 2: RESUME — re-entering UNDER_REVIEW with a paused clock.
  -- Overrides whatever tat_deadline_at the application sent in this UPDATE:
  -- the clock is never reset, only shifted by the paused business days.
  IF NEW.status = 'UNDER_REVIEW'
     AND OLD.status <> 'UNDER_REVIEW'
     AND OLD.tat_deadline_at IS NOT NULL
     AND OLD.tat_paused_at IS NOT NULL THEN
    pause_days := business_day_diff(
      (OLD.tat_paused_at AT TIME ZONE 'UTC')::date,
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
    );

    old_deadline_utc := OLD.tat_deadline_at AT TIME ZONE 'UTC';
    shifted_date := business_day_add(old_deadline_utc::date, pause_days);

    -- Shifted date + the original UTC time-of-day (preserves the
    -- 23:59:59Z convention used by the application).
    NEW.tat_deadline_at := (shifted_date + old_deadline_utc::time) AT TIME ZONE 'UTC';
    NEW.tat_paused_at := NULL;
    RETURN NEW;
  END IF;

  -- Branch 3: NEVER-RESET GUARD — re-entering UNDER_REVIEW with an existing
  -- deadline but no recorded pause (e.g., a contract the backfill skipped).
  -- Keep the existing deadline; discard any fresh value the application sent.
  IF NEW.status = 'UNDER_REVIEW'
     AND OLD.status <> 'UNDER_REVIEW'
     AND OLD.tat_deadline_at IS NOT NULL
     AND OLD.tat_paused_at IS NULL THEN
    NEW.tat_deadline_at := OLD.tat_deadline_at;
    RETURN NEW;
  END IF;

  -- First HOD approval (OLD.tat_deadline_at IS NULL) or any other status
  -- change: pass through untouched.
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_contract_tat_stopwatch"() OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."handle_contract_tat_stopwatch"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_contract_tat_stopwatch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_contract_tat_stopwatch"() TO "service_role";


DROP TRIGGER IF EXISTS "contract_tat_stopwatch_trigger" ON "public"."contracts";

CREATE TRIGGER "contract_tat_stopwatch_trigger"
  BEFORE UPDATE ON "public"."contracts"
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION "public"."handle_contract_tat_stopwatch"();


-- Rewritten validator: tat_breached_at block unchanged; the tat_deadline_at
-- permit is now STATUS-based (was value-based, requiring OLD.tat_deadline_at
-- IS NULL — the reroute re-approve crash). This function only validates and
-- never assigns, so trigger firing order does not matter.
CREATE OR REPLACE FUNCTION "public"."enforce_contract_tat_mutability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.tat_breached_at IS DISTINCT FROM OLD.tat_breached_at THEN
    RAISE EXCEPTION 'tat_breached_at is system-controlled and cannot be manually modified';
  END IF;

  IF NEW.tat_deadline_at IS DISTINCT FROM OLD.tat_deadline_at THEN
    IF NOT (
      NEW.status = 'UNDER_REVIEW'
      AND OLD.status IS DISTINCT FROM 'UNDER_REVIEW'
      AND NEW.tat_deadline_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'tat_deadline_at can only change when a contract enters UNDER_REVIEW';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
```

- [ ] **Step 2: Static verification (no DB)**

Run:
```bash
grep -c "CREATE OR REPLACE FUNCTION" supabase/migrations/20260722130000_add_tat_stopwatch.sql
grep -c "LEGAL_PENDING" supabase/migrations/20260722130000_add_tat_stopwatch.sql
grep -n "aging_business_days\|hod_approved_at\|contracts_repository_view" supabase/migrations/20260722130000_add_tat_stopwatch.sql
```
Expected: `2` functions; `1` match for LEGAL_PENDING (the header comment only — confirm it is not in code); the third grep matches only the header `Untouched :` comment lines (no code touches aging).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260722130000_add_tat_stopwatch.sql
git commit -m "Add TAT stopwatch migration: tat_paused_at column, pause/resume trigger, status-based mutability permit"
```

---

### Task 2: Rollback file

**Files:**
- Create: `supabase/rollbacks/20260722130000_add_tat_stopwatch_rollback.sql`

- [ ] **Step 1: Write the rollback file with exactly this content**

The restored function body below is the **verbatim original** from `supabase/migrations/20260511113928_remote_schema.sql:2152-2173`.

```sql
-- ============================================================
-- Rollback for 20260722130000_add_tat_stopwatch.sql
-- Drops the stopwatch trigger/function/column and restores the
-- ORIGINAL enforce_contract_tat_mutability() body verbatim
-- (from 20260511113928_remote_schema.sql).
-- WARNING: dropping tat_paused_at discards all pause state; any
-- deadline shifts already applied by resume events or the backfill
-- remain in tat_deadline_at and are NOT reverted.
-- ============================================================

DROP TRIGGER IF EXISTS "contract_tat_stopwatch_trigger" ON "public"."contracts";

DROP FUNCTION IF EXISTS "public"."handle_contract_tat_stopwatch"();

CREATE OR REPLACE FUNCTION "public"."enforce_contract_tat_mutability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.tat_breached_at IS DISTINCT FROM OLD.tat_breached_at THEN
    RAISE EXCEPTION 'tat_breached_at is system-controlled and cannot be manually modified';
  END IF;

  IF NEW.tat_deadline_at IS DISTINCT FROM OLD.tat_deadline_at THEN
    IF NOT (
      OLD.tat_deadline_at IS NULL
      AND OLD.status = 'HOD_PENDING'
      AND NEW.status IN ('UNDER_REVIEW', 'LEGAL_PENDING')
      AND NEW.tat_deadline_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'tat_deadline_at can only be set during HOD approval transition';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE "public"."contracts" DROP COLUMN IF EXISTS "tat_paused_at";
```

- [ ] **Step 2: Static verification — restored body matches the original**

Run:
```bash
grep -n "OLD.tat_deadline_at IS NULL" supabase/rollbacks/20260722130000_add_tat_stopwatch_rollback.sql
grep -n "LEGAL_PENDING" supabase/rollbacks/20260722130000_add_tat_stopwatch_rollback.sql
```
Expected: both present (the rollback intentionally restores the original value-based rule, including the obsolete `LEGAL_PENDING`, to be byte-faithful to the pre-migration state). Note: the original at `remote_schema.sql:2160-2168` did not include `AND NEW.tat_deadline_at IS NOT NULL`; it is implied by `OLD IS NULL AND NEW IS DISTINCT FROM OLD`, and keeping it makes the restore semantically identical — acceptable, but flag it in review if byte-exactness is preferred; in that case delete that one line.

- [ ] **Step 3: Commit**

```bash
git add supabase/rollbacks/20260722130000_add_tat_stopwatch_rollback.sql
git commit -m "Add rollback for TAT stopwatch migration"
```

---

### Task 3: Backfill script

**Files:**
- Create: `supabase/backfills/20260722_tat_stopwatch_backfill.sql` (new directory)

- [ ] **Step 1: Write the backfill file with exactly this content**

```sql
-- ============================================================
-- ONE-TIME BACKFILL: TAT stopwatch for existing contracts
-- ------------------------------------------------------------
-- Run manually, ONCE, as postgres (Supabase SQL editor), only
-- AFTER migration 20260722130000_add_tat_stopwatch.sql is applied.
--
-- What it does (single transaction):
--   1. Replays audit_logs status transitions per contract with a
--      tat_deadline_at (ALL such contracts, terminal included).
--   2. Chain guard: every from_status must equal the previous
--      to_status and the final to_status must equal the current
--      contracts.status — otherwise the contract is SKIPPED and
--      reported, never written (audit inserts are non-blocking in
--      the app, so history can have gaps).
--   3. Option A write: tat_deadline_at shifted forward by the sum
--      of closed leave->re-enter UNDER_REVIEW pause windows
--      (business days, UTC dates); tat_paused_at set to the last
--      leave timestamp for contracts currently outside UNDER_REVIEW.
--   4. Option B (READ-ONLY cross-check report): reconstructed
--      deadline = first UNDER_REVIEW entry + 7 business days +
--      pauses. Reported, never written.
--
-- Review the four report SELECT outputs BEFORE the final COMMIT
-- (run interactively; replace COMMIT with ROLLBACK to dry-run).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Ordered status transitions per candidate contract.
--    Filter on metadata ? 'to_status' (NOT event_type: hod.approve
--    is logged as CONTRACT_APPROVED, not CONTRACT_TRANSITIONED).
--    No-op rows (from = to) are dropped; the creation row
--    (from_status absent, transition 'system.initial_route') is
--    kept and tolerated as the chain start.
-- ------------------------------------------------------------
CREATE TEMP TABLE tat_backfill_transitions ON COMMIT DROP AS
SELECT
  c.id AS contract_id,
  al.event_sequence,
  al.created_at,
  al.metadata->>'from_status' AS from_status,
  al.metadata->>'to_status'   AS to_status,
  ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY al.event_sequence) AS seq,
  LAG(al.metadata->>'to_status') OVER (PARTITION BY c.id ORDER BY al.event_sequence) AS prev_to_status
FROM public.contracts c
JOIN public.audit_logs al
  ON al.resource_type = 'contract'
 AND al.resource_id = c.id::text
 AND al.tenant_id = c.tenant_id
 AND al.metadata ? 'to_status'
 AND (al.metadata->>'from_status') IS DISTINCT FROM (al.metadata->>'to_status')
WHERE c.tat_deadline_at IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Chain guard aggregates.
-- ------------------------------------------------------------
CREATE TEMP TABLE tat_backfill_chain ON COMMIT DROP AS
SELECT
  contract_id,
  bool_and(seq = 1 OR prev_to_status = from_status) AS chain_ok,
  (ARRAY_AGG(to_status ORDER BY seq DESC))[1] AS final_to_status,
  COUNT(*)::int AS transition_count,
  MIN(created_at) FILTER (WHERE to_status = 'UNDER_REVIEW') AS first_under_review_at
FROM tat_backfill_transitions
GROUP BY contract_id;

-- ------------------------------------------------------------
-- 3. Pause windows: each departure from UNDER_REVIEW opens a
--    window; the next arrival into UNDER_REVIEW closes it.
-- ------------------------------------------------------------
CREATE TEMP TABLE tat_backfill_windows ON COMMIT DROP AS
SELECT
  l.contract_id,
  l.created_at AS left_at,
  (
    SELECT MIN(e.created_at)
    FROM tat_backfill_transitions e
    WHERE e.contract_id = l.contract_id
      AND e.to_status = 'UNDER_REVIEW'
      AND e.event_sequence > l.event_sequence
  ) AS reentered_at
FROM tat_backfill_transitions l
WHERE l.from_status = 'UNDER_REVIEW';

-- ------------------------------------------------------------
-- 4. Per-contract shift + open pause.
-- ------------------------------------------------------------
CREATE TEMP TABLE tat_backfill_calc ON COMMIT DROP AS
SELECT
  contract_id,
  COALESCE(SUM(
    public.business_day_diff(
      (left_at AT TIME ZONE 'UTC')::date,
      (reentered_at AT TIME ZONE 'UTC')::date
    )
  ) FILTER (WHERE reentered_at IS NOT NULL), 0)::int AS shift_days,
  MAX(left_at) FILTER (WHERE reentered_at IS NULL) AS open_paused_at,
  COUNT(*) FILTER (WHERE reentered_at IS NULL)::int AS open_window_count
FROM tat_backfill_windows
GROUP BY contract_id;

-- ------------------------------------------------------------
-- 5. Final plan: eligibility, Option A values, Option B cross-check.
-- ------------------------------------------------------------
CREATE TEMP TABLE tat_backfill_plan ON COMMIT DROP AS
SELECT
  c.id AS contract_id,
  c.tenant_id,
  c.status,
  c.tat_deadline_at AS old_deadline_at,
  c.tat_paused_at   AS old_paused_at,
  COALESCE(calc.shift_days, 0) AS shift_days,
  ch.transition_count,
  CASE
    WHEN ch.contract_id IS NULL THEN 'NO_TRANSITIONS'
    WHEN NOT ch.chain_ok THEN 'CHAIN_BROKEN'
    WHEN ch.final_to_status IS DISTINCT FROM c.status THEN 'FINAL_STATUS_MISMATCH'
    WHEN COALESCE(calc.open_window_count, 0) > 1 THEN 'MULTIPLE_OPEN_WINDOWS'
    ELSE NULL
  END AS skip_reason,
  -- Option A: shifted stored deadline, original UTC time-of-day preserved.
  (
    public.business_day_add(
      (c.tat_deadline_at AT TIME ZONE 'UTC')::date,
      COALESCE(calc.shift_days, 0)
    ) + ((c.tat_deadline_at AT TIME ZONE 'UTC')::time)
  ) AT TIME ZONE 'UTC' AS new_deadline_at,
  CASE
    WHEN c.status = 'UNDER_REVIEW' THEN NULL
    ELSE calc.open_paused_at
  END AS new_paused_at,
  -- Option B (read-only): reconstruction from first UNDER_REVIEW entry.
  CASE
    WHEN ch.first_under_review_at IS NOT NULL THEN
      (
        public.business_day_add(
          (ch.first_under_review_at AT TIME ZONE 'UTC')::date,
          7 + COALESCE(calc.shift_days, 0)
        ) + TIME '23:59:59'
      ) AT TIME ZONE 'UTC'
  END AS reconstructed_deadline_at
FROM public.contracts c
LEFT JOIN tat_backfill_chain ch ON ch.contract_id = c.id
LEFT JOIN tat_backfill_calc calc ON calc.contract_id = c.id
WHERE c.tat_deadline_at IS NOT NULL;

-- ------------------------------------------------------------
-- REPORT A: rows that will be written (before/after).
-- ------------------------------------------------------------
SELECT contract_id, status, shift_days,
       old_deadline_at, new_deadline_at,
       old_paused_at, new_paused_at
FROM tat_backfill_plan
WHERE skip_reason IS NULL
  AND (old_deadline_at IS DISTINCT FROM new_deadline_at
       OR old_paused_at IS DISTINCT FROM new_paused_at)
ORDER BY shift_days DESC, contract_id;

-- ------------------------------------------------------------
-- REPORT B: skipped contracts (never written) with reason.
-- ------------------------------------------------------------
SELECT contract_id, status, skip_reason, transition_count
FROM tat_backfill_plan
WHERE skip_reason IS NOT NULL
ORDER BY skip_reason, contract_id;

-- ------------------------------------------------------------
-- REPORT C: Option B cross-check disagreements (date-level).
--   Disagreement usually means the stored deadline was not
--   first-entry + 7 business days (e.g., historical policy drift).
--   Option A remains the written value either way.
-- ------------------------------------------------------------
SELECT contract_id, status, shift_days,
       new_deadline_at, reconstructed_deadline_at
FROM tat_backfill_plan
WHERE skip_reason IS NULL
  AND (new_deadline_at AT TIME ZONE 'UTC')::date
      IS DISTINCT FROM (reconstructed_deadline_at AT TIME ZONE 'UTC')::date
ORDER BY contract_id;

-- ------------------------------------------------------------
-- REPORT D: summary counts.
-- ------------------------------------------------------------
SELECT
  COUNT(*) AS candidates,
  COUNT(*) FILTER (WHERE skip_reason IS NULL) AS eligible,
  COUNT(*) FILTER (WHERE skip_reason IS NULL
                   AND (old_deadline_at IS DISTINCT FROM new_deadline_at
                        OR old_paused_at IS DISTINCT FROM new_paused_at)) AS will_update,
  COUNT(*) FILTER (WHERE skip_reason = 'NO_TRANSITIONS') AS skipped_no_transitions,
  COUNT(*) FILTER (WHERE skip_reason = 'CHAIN_BROKEN') AS skipped_chain_broken,
  COUNT(*) FILTER (WHERE skip_reason = 'FINAL_STATUS_MISMATCH') AS skipped_final_mismatch,
  COUNT(*) FILTER (WHERE skip_reason = 'MULTIPLE_OPEN_WINDOWS') AS skipped_multi_open
FROM tat_backfill_plan;

-- ------------------------------------------------------------
-- WRITE (Option A only). The mutability trigger would reject a
-- deadline change without a status change, and update_contracts_
-- updated_at would silently bump updated_at — disable both for
-- this statement only, inside the same transaction. The stopwatch
-- trigger cannot fire (status is not updated). row_version,
-- tat_breached_at untouched.
-- ------------------------------------------------------------
ALTER TABLE public.contracts DISABLE TRIGGER enforce_contract_tat_mutability_trigger;
ALTER TABLE public.contracts DISABLE TRIGGER update_contracts_updated_at;

UPDATE public.contracts c
SET tat_deadline_at = p.new_deadline_at,
    tat_paused_at   = p.new_paused_at
FROM tat_backfill_plan p
WHERE c.id = p.contract_id
  AND p.skip_reason IS NULL
  AND (c.tat_deadline_at IS DISTINCT FROM p.new_deadline_at
       OR c.tat_paused_at IS DISTINCT FROM p.new_paused_at);

ALTER TABLE public.contracts ENABLE TRIGGER update_contracts_updated_at;
ALTER TABLE public.contracts ENABLE TRIGGER enforce_contract_tat_mutability_trigger;

-- Replace with ROLLBACK; for a dry run (reports still print).
COMMIT;
```

- [ ] **Step 2: Static verification (no DB)**

Run:
```bash
grep -c "DISABLE TRIGGER" supabase/backfills/20260722_tat_stopwatch_backfill.sql
grep -c "ENABLE TRIGGER" supabase/backfills/20260722_tat_stopwatch_backfill.sql
grep -c "ON COMMIT DROP" supabase/backfills/20260722_tat_stopwatch_backfill.sql
grep -n "event_type" supabase/backfills/20260722_tat_stopwatch_backfill.sql
```
Expected: `2` / `2` (every DISABLE paired with ENABLE); `5` temp tables; **no** `event_type` filter anywhere (only `metadata ? 'to_status'` — the hod.approve/CONTRACT_APPROVED gotcha; comment mentions are fine, code filter is not).

- [ ] **Step 3: Commit**

```bash
git add supabase/backfills/20260722_tat_stopwatch_backfill.sql
git commit -m "Add one-time TAT stopwatch backfill script (written only, not executed)"
```

---

### Task 4: Spec cross-check and STOP

**Files:**
- Read: `docs/superpowers/specs/2026-07-22-tat-stopwatch-design.md`
- Read: the three files created above

- [ ] **Step 1: Verify each spec requirement maps to written SQL**

Checklist (spec § → file):
- §4.1 column nullable/no default → migration `ADD COLUMN`
- §4.2 pause / resume-override / never-reset-guard / first-approval pass-through branches → migration function branches 1/2/3/final RETURN
- §4.3 status-based permit, `tat_breached_at` block unchanged, no `LEGAL_PENDING` in code → migration rewritten function
- §4.4 rollback restores original verbatim → rollback file
- §5.1-5.4 all-with-deadline scope, `metadata ? 'to_status'` filter, chain guard skip reasons, closed/open windows → backfill temp tables 1-5
- §5.5 Option A write + §5.6 Option B read-only → backfill UPDATE + REPORT C
- §5.7 trigger disable/enable in-transaction, `row_version` untouched → backfill WRITE block
- §5.8 reports a-d → REPORT A-D
- §7 nothing references `aging_business_days`, the view, or `hod_approved_at` in any DDL/DML

- [ ] **Step 2: Confirm nothing was applied**

Run: `git status` — only the three new files committed; no supabase CLI or psql commands were executed at any point.

- [ ] **Step 3: STOP and hand back to the user**

Report: files written and committed; migration + backfill await the user's own review and manual application. Do not apply, do not push, do not open a PR unless asked.
