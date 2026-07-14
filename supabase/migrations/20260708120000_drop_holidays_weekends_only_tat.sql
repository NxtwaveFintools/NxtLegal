-- ============================================================
-- Migration: Drop public.holidays and switch TAT engine to weekends-only
-- Functions  : business_day_add, business_day_diff
-- Reason     : holidays table is empty with no seed-data migration in
--              this repo; confirmed business requirement is weekends-only
--              TAT/SLA calculation (no holiday exclusion).
-- Date       : 2026-07-08
-- Idempotent : function rewrites are idempotent (CREATE OR REPLACE);
--              DROP TABLE IF EXISTS is safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION "public"."business_day_add"("start_date" "date", "days" integer) RETURNS "date"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  direction INTEGER := CASE WHEN days >= 0 THEN 1 ELSE -1 END;
  remaining INTEGER := ABS(days);
  cursor_date DATE := start_date;
BEGIN
  IF days = 0 THEN
    RETURN start_date;
  END IF;

  WHILE remaining > 0 LOOP
    cursor_date := cursor_date + direction;

    IF EXTRACT(ISODOW FROM cursor_date) < 6 THEN
      remaining := remaining - 1;
    END IF;
  END LOOP;

  RETURN cursor_date;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."business_day_diff"("start_date" "date", "end_date" "date") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH bounds AS (
    SELECT LEAST(start_date, end_date) AS lo,
           GREATEST(start_date, end_date) AS hi,
           CASE WHEN end_date >= start_date THEN 1 ELSE -1 END AS direction
  ),
  days AS (
    SELECT gs::date AS day
    FROM bounds,
    generate_series(bounds.lo + 1, bounds.hi, interval '1 day') AS gs
  ),
  business_days AS (
    SELECT COUNT(*)::INTEGER AS count_days
    FROM days d
    WHERE EXTRACT(ISODOW FROM d.day) < 6
  )
  SELECT COALESCE((SELECT b.direction * bd.count_days FROM bounds b CROSS JOIN business_days bd), 0);
$$;


-- Drop last, in the same transaction: only takes effect if both
-- function rewrites above succeeded.
DROP TABLE IF EXISTS "public"."holidays";
