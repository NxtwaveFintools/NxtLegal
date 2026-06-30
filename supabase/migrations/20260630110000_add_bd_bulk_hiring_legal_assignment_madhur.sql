-- ============================================================
-- Migration: Assign Madhur Goyal (LEGAL_TEAM) to BD - Bulk Hiring
-- Legal     : Madhur Goyal (madhur.goyal@nxtwave.co.in)
-- Team      : BD - Bulk Hiring
-- Date      : 2026-06-30
-- Idempotent: safe to run multiple times on any environment
-- ============================================================

DO $$
DECLARE
  v_tenant_id    uuid;
  v_team_id      uuid;
  v_user_id      uuid;
  v_legal_email  text := 'madhur.goyal@nxtwave.co.in';
  v_team_name    text := 'BD - Bulk Hiring';
BEGIN

  -- Resolve tenant dynamically
  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE deleted_at IS NULL
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No active tenant found';
  END IF;

  -- Resolve BD - Bulk Hiring team id dynamically
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE tenant_id  = v_tenant_id
    AND name       = v_team_name
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Team "%" not found', v_team_name;
  END IF;

  -- Resolve Madhur Goyal user id dynamically
  SELECT id INTO v_user_id
  FROM public.users
  WHERE tenant_id  = v_tenant_id
    AND email      = v_legal_email
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Legal team user "%" not found', v_legal_email;
  END IF;

  -- Upsert legal assignment
  INSERT INTO public.department_legal_assignments
    (tenant_id, department_id, user_id, is_active, assigned_at, created_at, updated_at)
  VALUES
    (v_tenant_id, v_team_id, v_user_id, true, now(), now(), now())
  ON CONFLICT (tenant_id, department_id, user_id) DO UPDATE
  SET
    is_active   = true,
    revoked_by  = null,
    revoked_at  = null,
    deleted_at  = null,
    updated_at  = now();

  RAISE NOTICE 'Done: "%" assigned as legal contact for team "%"', v_legal_email, v_team_name;

END $$;

-- Verification
SELECT
  t.name  AS team_name,
  u.full_name,
  u.email,
  u.role,
  dla.is_active,
  dla.assigned_at
FROM public.department_legal_assignments dla
JOIN public.teams t
  ON t.id        = dla.department_id
 AND t.tenant_id = dla.tenant_id
JOIN public.users u
  ON u.id        = dla.user_id
 AND u.tenant_id = dla.tenant_id
WHERE t.name  = 'BD - Bulk Hiring'
  AND u.email = 'madhur.goyal@nxtwave.co.in';
