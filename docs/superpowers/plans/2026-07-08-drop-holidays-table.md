# Drop public.holidays Table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a migration file that rewrites `business_day_add`/`business_day_diff` to be weekends-only and drops `public.holidays`, plus a matching rollback file — without applying either to any database.

**Architecture:** Two standalone SQL files, no application code changes. `CREATE OR REPLACE FUNCTION` preserves the two functions' OID/owner/grants/signatures, so `contracts_repository_view` and the `.rpc('business_day_add', ...)` call site in `supabase-contract-query-repository.ts` keep working unmodified.

**Tech Stack:** PostgreSQL / Supabase migrations (plain `.sql` files, no ORM).

## Global Constraints

- Do NOT apply either file to any database (no `mcp__plugin_supabase_supabase__apply_migration`, no `supabase db push`, no `psql`) — this plan only writes files to the repo.
- Migration file path: `supabase/migrations/20260708120000_drop_holidays_weekends_only_tat.sql`
- Rollback file path: `supabase/rollbacks/20260708120000_drop_holidays_weekends_only_tat_rollback.sql` (repo's dominant `_rollback.sql` naming convention)
- In the migration, `DROP TABLE IF EXISTS public.holidays;` must be the last statement, after both `CREATE OR REPLACE FUNCTION` statements, so it only takes effect if both rewrites succeeded.
- Function bodies must preserve the original control flow, formatting, and double-quoted-identifier style from `supabase/migrations/20260511113928_remote_schema.sql:1604-1663`, with only the holiday `NOT EXISTS` clause removed.
- The rollback file must include a comment warning that the restored `holidays` table will be empty (no seed-data migration exists anywhere in the repo to restore rows from).

---

### Task 1: Write the migration file

**Files:**
- Create: `supabase/migrations/20260708120000_drop_holidays_weekends_only_tat.sql`

**Interfaces:**
- Consumes: original function bodies from `supabase/migrations/20260511113928_remote_schema.sql:1604-1663` (reference only, not modified).
- Produces: `public.business_day_add(date, integer) RETURNS date` and `public.business_day_diff(date, date) RETURNS integer`, both weekends-only, and `public.holidays` no longer exists. Task 2's rollback file restores these to their pre-migration state.

- [ ] **Step 1: Confirm the file doesn't exist yet**

Run: `test -f "supabase/migrations/20260708120000_drop_holidays_weekends_only_tat.sql" && echo EXISTS || echo MISSING`
Expected: `MISSING`

- [ ] **Step 2: Write the migration file**

```sql
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
```

- [ ] **Step 3: Verify the holiday check was fully removed from both function bodies**

Run: `grep -c "holidays" "supabase/migrations/20260708120000_drop_holidays_weekends_only_tat.sql"`
Expected: `1` (the only occurrence is the `DROP TABLE` line itself)

- [ ] **Step 4: Verify the DROP TABLE statement is present and targets the right table**

Run: `grep -n "DROP TABLE IF EXISTS \"public\".\"holidays\";" "supabase/migrations/20260708120000_drop_holidays_weekends_only_tat.sql"`
Expected: one matching line number printed, no error

- [ ] **Step 5: Verify DROP TABLE is the last statement in the file (comes after both CREATE OR REPLACE FUNCTION blocks)**

Run: `grep -n "CREATE OR REPLACE FUNCTION\|DROP TABLE IF EXISTS" "supabase/migrations/20260708120000_drop_holidays_weekends_only_tat.sql"`
Expected: three lines in this order — `business_day_add` CREATE, `business_day_diff` CREATE, then `DROP TABLE IF EXISTS "public"."holidays";` last

- [ ] **Step 6: Commit**

```bash
git add "supabase/migrations/20260708120000_drop_holidays_weekends_only_tat.sql"
git commit -m "feat: drop public.holidays, switch TAT engine to weekends-only"
```

---

### Task 2: Write the rollback file

**Files:**
- Create: `supabase/rollbacks/20260708120000_drop_holidays_weekends_only_tat_rollback.sql`

**Interfaces:**
- Consumes: nothing from Task 1 at apply-time (this file is never chained to the migration by tooling — it's a standalone manual-restore script), but its content must exactly reverse what Task 1 wrote: same table schema, same function bodies as the original `20260511113928_remote_schema.sql:1604-1663, 2868-2877, 3184-3190, 3587-3591, 4918-4920`.
- Produces: `public.holidays` table (empty) recreated with original schema/constraints/indexes/grants, and both functions restored to their holiday-aware bodies.

- [ ] **Step 1: Confirm the file doesn't exist yet**

Run: `test -f "supabase/rollbacks/20260708120000_drop_holidays_weekends_only_tat_rollback.sql" && echo EXISTS || echo MISSING`
Expected: `MISSING`

- [ ] **Step 2: Write the rollback file**

```sql
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
```

- [ ] **Step 3: Verify the table recreation statement is present**

Run: `grep -c "CREATE TABLE IF NOT EXISTS \"public\".\"holidays\"" "supabase/rollbacks/20260708120000_drop_holidays_weekends_only_tat_rollback.sql"`
Expected: `1`

- [ ] **Step 4: Verify both functions have the holiday-aware `NOT EXISTS` clause restored**

Run: `grep -c "NOT EXISTS" "supabase/rollbacks/20260708120000_drop_holidays_weekends_only_tat_rollback.sql"`
Expected: `2` (one in `business_day_add`, one in `business_day_diff`)

- [ ] **Step 5: Verify the empty-table warning comment is present**

Run: `grep -n "WARNING" "supabase/rollbacks/20260708120000_drop_holidays_weekends_only_tat_rollback.sql"`
Expected: one matching line printed, no error

- [ ] **Step 6: Commit**

```bash
git add "supabase/rollbacks/20260708120000_drop_holidays_weekends_only_tat_rollback.sql"
git commit -m "docs: add rollback for public.holidays drop migration"
```
