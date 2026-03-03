-- =============================================================================
-- Drop Legacy Tables: holidays, department_role_map, team_members
--
-- Reason:
--   - holidays:           Schema created in phase1 hotfix (20260221110000) but
--                         never populated (0 rows in both DEV and PROD). No
--                         business logic or repository code references it.
--
--   - department_role_map: Created in enterprise RBAC foundation
--                         (20260221170000). Completely superseded by
--                         team_role_mappings which handles the same mapping
--                         concern with 17 live rows and full repository support.
--                         0 rows in both DEV and PROD.
--
--   - team_members:       Created in (20260220113314). Fully superseded by
--                         team_role_mappings which has richer semantics, live
--                         data (17 rows DEV, 2 rows PROD), and active repo code.
--                         Only reference in codebase is the auto-generated
--                         database.ts type definition — no real usage.
--
-- Rollback: Restore from git history (supabase/migrations/ files above).
-- CASCADE is used to clean up associated indexes, triggers, and policies.
-- =============================================================================

-- -------------------------------------------------------
-- 1. holidays
-- -------------------------------------------------------
DROP INDEX IF EXISTS public.idx_holidays_date_type;
DROP TABLE IF EXISTS public.holidays CASCADE;

-- -------------------------------------------------------
-- 2. department_role_map
-- -------------------------------------------------------
DROP INDEX IF EXISTS public.idx_department_role_map_active_unique;
DROP TABLE IF EXISTS public.department_role_map CASCADE;

-- -------------------------------------------------------
-- 3. team_members
-- -------------------------------------------------------
DROP INDEX IF EXISTS public.idx_team_members_primary_role;
DROP INDEX IF EXISTS public.idx_team_members_tenant_user;
DROP INDEX IF EXISTS public.idx_team_members_tenant_team;
DROP TABLE IF EXISTS public.team_members CASCADE;
