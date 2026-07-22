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
