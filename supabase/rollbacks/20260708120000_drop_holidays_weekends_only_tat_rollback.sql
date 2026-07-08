-- Rollback: Restore public.holidays table and holiday-aware business_day_add/business_day_diff
-- WARNING: This rollback recreates an EMPTY holidays table — there is no
-- seed-data migration anywhere in this repo to restore rows from. Restored
-- holiday exclusion logic will have NO EFFECT until holiday rows are
-- manually re-inserted.

CREATE TABLE IF NOT EXISTS "public"."holidays" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "holiday_date" "date" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'PUBLIC'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."holidays" OWNER TO "postgres";

ALTER TABLE ONLY "public"."holidays"
  ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."holidays"
  ADD CONSTRAINT "holidays_holiday_date_type_key" UNIQUE ("holiday_date", "type");

CREATE INDEX "idx_holidays_holiday_date" ON "public"."holidays" USING "btree" ("holiday_date");
CREATE INDEX "idx_holidays_holiday_date_type" ON "public"."holidays" USING "btree" ("holiday_date", "type");

GRANT ALL ON TABLE "public"."holidays" TO "anon";
GRANT ALL ON TABLE "public"."holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."holidays" TO "service_role";


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

    IF EXTRACT(ISODOW FROM cursor_date) < 6
       AND NOT EXISTS (
         SELECT 1
         FROM public.holidays h
         WHERE h.holiday_date = cursor_date
       ) THEN
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.holidays h
        WHERE h.holiday_date = d.day
      )
  )
  SELECT COALESCE((SELECT b.direction * bd.count_days FROM bounds b CROSS JOIN business_days bd), 0);
$$;
