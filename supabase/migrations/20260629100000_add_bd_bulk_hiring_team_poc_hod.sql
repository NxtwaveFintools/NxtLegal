-- ============================================================
-- Migration: Add BD - Bulk Hiring department with POC and HOD
-- Team     : BD - Bulk Hiring
-- POC      : Harshavardhan Reddy (harshavardhan.reddy@nxtwave.co.in)
-- HOD      : Naresh (naresh@nxtwave.tech)
-- Auth     : Microsoft SSO (no password_hash)
-- Date     : 2026-06-29
-- Idempotent: safe to run multiple times on any environment
-- ============================================================

DO $$
DECLARE
  v_tenant_id  uuid;
  v_team_id    uuid;
  v_poc_email  text := 'harshavardhan.reddy@nxtwave.co.in';
  v_hod_email  text := 'naresh@nxtwave.tech';
  v_poc_name   text := 'Harshavardhan Reddy';
  v_hod_name   text := 'Naresh';
  v_team_name  text := 'BD - Bulk Hiring';
BEGIN

  -- Resolve tenant dynamically
  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE deleted_at IS NULL
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No active tenant found';
  END IF;

  -- 1. Upsert the team
  INSERT INTO public.teams (tenant_id, name, poc_email, hod_email, poc_name, hod_name, is_active, deleted_at)
  VALUES (v_tenant_id, v_team_name, v_poc_email, v_hod_email, v_poc_name, v_hod_name, true, null)
  ON CONFLICT (tenant_id, name) DO UPDATE
  SET
    poc_email  = EXCLUDED.poc_email,
    hod_email  = EXCLUDED.hod_email,
    poc_name   = EXCLUDED.poc_name,
    hod_name   = EXCLUDED.hod_name,
    is_active  = true,
    deleted_at = null,
    updated_at = now();

  -- Resolve the team id (may have just been created or already existed)
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE tenant_id  = v_tenant_id
    AND name       = v_team_name
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Team "%" could not be resolved after upsert', v_team_name;
  END IF;

  -- 2. Upsert POC user (Microsoft SSO — no password_hash)
  INSERT INTO public.users (tenant_id, email, full_name, password_hash, role, team_id, is_active, deleted_at, token_version)
  VALUES (v_tenant_id, v_poc_email, v_poc_name, null, 'POC', v_team_id, true, null, 0)
  ON CONFLICT (tenant_id, email) DO UPDATE
  SET
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    team_id    = EXCLUDED.team_id,
    is_active  = true,
    deleted_at = null,
    updated_at = now();

  -- 3. Upsert HOD user (Microsoft SSO — no password_hash)
  INSERT INTO public.users (tenant_id, email, full_name, password_hash, role, team_id, is_active, deleted_at, token_version)
  VALUES (v_tenant_id, v_hod_email, v_hod_name, null, 'HOD', v_team_id, true, null, 0)
  ON CONFLICT (tenant_id, email) DO UPDATE
  SET
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    team_id    = EXCLUDED.team_id,
    is_active  = true,
    deleted_at = null,
    updated_at = now();

  -- 4. Upsert POC team_role_mapping
  INSERT INTO public.team_role_mappings (tenant_id, team_id, email, role_type, active_flag, assigned_by, deleted_at)
  VALUES (v_tenant_id, v_team_id, v_poc_email, 'POC', true, null, null)
  ON CONFLICT (tenant_id, team_id, email, role_type) DO UPDATE
  SET
    active_flag = true,
    assigned_by = null,
    deleted_at  = null,
    replaced_by = null,
    replaced_at = null,
    updated_at  = now();

  -- 5. Upsert HOD team_role_mapping
  INSERT INTO public.team_role_mappings (tenant_id, team_id, email, role_type, active_flag, assigned_by, deleted_at)
  VALUES (v_tenant_id, v_team_id, v_hod_email, 'HOD', true, null, null)
  ON CONFLICT (tenant_id, team_id, email, role_type) DO UPDATE
  SET
    active_flag = true,
    assigned_by = null,
    deleted_at  = null,
    replaced_by = null,
    replaced_at = null,
    updated_at  = now();

  RAISE NOTICE 'Done: team "%" seeded with POC (%) and HOD (%)', v_team_name, v_poc_email, v_hod_email;

END $$;

-- Verification
SELECT
  u.email,
  u.full_name,
  u.role,
  t.name AS team_name,
  u.is_active,
  (u.password_hash IS NOT NULL) AS has_password
FROM public.users u
JOIN public.teams t
  ON t.id         = u.team_id
 AND t.tenant_id  = u.tenant_id
WHERE u.email IN (
  'harshavardhan.reddy@nxtwave.co.in',
  'naresh@nxtwave.tech'
)
ORDER BY u.role;
