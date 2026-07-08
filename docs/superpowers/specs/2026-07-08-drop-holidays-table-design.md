# Drop `public.holidays` table and switch TAT engine to weekends-only

## Context

`public.holidays` is currently empty in production with no seed-data migration anywhere in the repo. It is referenced by two Postgres functions defined in the single baseline migration `supabase/migrations/20260511113928_remote_schema.sql`:

- **`business_day_add(start_date date, days integer) RETURNS date`** (lines 1604-1632) — walks forward/backward day-by-day, skipping Saturdays/Sundays and any date present in `public.holidays`. Called directly via `supabase.rpc('business_day_add', ...)` from `src/core/infra/repositories/supabase-contract-query-repository.ts:3033` during the HOD-approval transition, to set `contracts.tat_deadline_at` (`contractRepositoryTatPolicy.businessDays` = 7, `src/core/constants/contracts.ts:349`).
- **`business_day_diff(start_date date, end_date date) RETURNS integer`** (lines 1638-1663) — counts business days between two dates with the same holiday exclusion. Never called via `.rpc()` directly; it's embedded in `contracts_repository_view` (lines 2794-2824), which computes `aging_business_days`, `is_tat_breached`, and `near_breach` live on every read.

No function named `calculate_tat_deadline` exists in this codebase.

Because both functions test `NOT EXISTS (SELECT 1 FROM holidays WHERE holiday_date = ...)` against an empty table, holidays currently have **zero effect** on TAT calculations — the engine already behaves as weekends-only in practice. `DROP TABLE public.holidays` today would still break things, though: both functions reference the table by name in their bodies, so every call would error at runtime the moment the table disappears — breaking contract-approval transitions (`business_day_add`) and the entire contracts repository/dashboard listing (`business_day_diff`, via the view).

Confirmed with the user: weekends-only is the intended business behavior going forward (no requirement to exclude Indian public holidays from the SLA clock). This spec covers decoupling the TAT engine from `holidays` and then dropping the table.

Other findings surfaced during the audit that are explicitly **out of scope** for this change:
- `contracts.tat_breached_at` is guarded by a mutability trigger but is never written anywhere in the repo (dead column) — not touched here.
- `holidays` has no RLS policy (blanket grants only) — moot once the table is dropped.
- `src/types/database.ts` (generated Supabase types) is missing the `holidays` table entry entirely, despite having the `business_day_add`/`business_day_diff` RPC signatures — pre-existing staleness, not something this change needs to fix, since no app code queries the `holidays` table directly.

## Approach

Single migration, applied atomically:

1. `CREATE OR REPLACE FUNCTION business_day_add` — identical control flow, with the holiday anti-join clause removed from the loop condition, leaving only the `EXTRACT(ISODOW FROM cursor_date) < 6` weekend check.
2. `CREATE OR REPLACE FUNCTION business_day_diff` — identical structure, with the holiday anti-join clause removed from the `business_days` CTE's `WHERE`.
3. `DROP TABLE IF EXISTS public.holidays;` — last statement in the same transaction, so it only takes effect once both function rewrites above have succeeded.

`CREATE OR REPLACE FUNCTION` preserves OID, owner, and grants as long as argument/return types don't change (they don't here), so:
- `contracts_repository_view`, which calls `business_day_diff` inline, requires **no changes** and keeps working.
- The RPC call site in `supabase-contract-query-repository.ts:3033` requires **no changes**.
- No `database.ts` regeneration is needed — the `holidays` table was never in the generated types to begin with, and the two RPC signatures (`Args`/`Returns`) are unchanged.

A matching rollback file restores the original holiday-aware behavior if ever needed, recreating an **empty** `holidays` table (there is no seed data anywhere in the repo to restore) plus the original function bodies.

## Files

**Migration:** `supabase/migrations/20260708120000_drop_holidays_weekends_only_tat.sql`
- Header comment block (matching repo convention: Migration / Date / Idempotent notes).
- `CREATE OR REPLACE FUNCTION public.business_day_add(...)` — weekends-only body.
- `CREATE OR REPLACE FUNCTION public.business_day_diff(...)` — weekends-only body.
- `DROP TABLE IF EXISTS public.holidays;`

**Rollback:** `supabase/rollbacks/20260708120000_drop_holidays_weekends_only_tat_rollback.sql` (matching the repo's dominant `_rollback.sql` naming convention)
- Warning comment: restored table will be **empty** — no seed data to restore, so holiday exclusion has no effect until someone manually inserts holiday rows.
- `CREATE TABLE IF NOT EXISTS public.holidays` with original columns, primary key, `holidays_holiday_date_type_key` unique constraint, both indexes (`idx_holidays_holiday_date`, `idx_holidays_holiday_date_type`), and original grants (`anon`/`authenticated`/`service_role`).
- `CREATE OR REPLACE FUNCTION public.business_day_add(...)` — original holiday-aware body.
- `CREATE OR REPLACE FUNCTION public.business_day_diff(...)` — original holiday-aware body.

Neither file is applied to any database as part of this work — they are written to the repo only, for the user to review and apply separately.

## Verification (for whoever applies the migration later)

- `SELECT proname, prosrc FROM pg_proc WHERE proname IN ('business_day_add','business_day_diff');` — confirm neither `prosrc` references `holidays` anymore.
- `SELECT * FROM public.contracts_repository_view LIMIT 1;` — confirm the view still selects cleanly (exercises `business_day_diff`).
- Exercise an HOD-approval transition in a non-prod environment and confirm `tat_deadline_at` is still set to a sane date (exercises `business_day_add` via the RPC call).
- `SELECT to_regclass('public.holidays');` — confirm it returns `NULL` after the drop.

## Out of scope

- Seeding holiday data (Path B) — rejected; weekends-only is the confirmed business requirement.
- Removing the dead `tat_breached_at` column/trigger.
- Adding RLS to `holidays` (moot — table is being dropped).
- Regenerating `src/types/database.ts`.
- Applying the migration to any database.
