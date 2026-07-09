-- ============================================================
-- Migration : Enable Row Level Security on public.holidays
-- Reason    : Supabase Security Advisor flagged "RLS Disabled in Public"
--             for public.holidays. This table holds reference data
--             (public/optional holiday dates) used for TAT (Turnaround
--             Time) deadline calculations across the app.
-- Policy    : `authenticated` role may SELECT all rows — the table is
--             global reference data, not tenant-scoped, so `USING (true)`
--             is correct here (not a BOLA/IDOR risk since there is no
--             per-row ownership to enforce).
--             No INSERT/UPDATE/DELETE policies are created, so those
--             operations are denied by default for anon/authenticated
--             clients once RLS is enabled. service_role (used by trusted
--             server-side code/migrations) bypasses RLS entirely and is
--             unaffected.
-- Date      : 2026-07-08
-- ============================================================

ALTER TABLE "public"."holidays" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holidays_authenticated_select" ON "public"."holidays"
  FOR SELECT
  TO "authenticated"
  USING (true);
