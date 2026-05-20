-- ============================================================
-- Migration: Replace Finance Operations POC
-- Old POC : Hemanth Kothuru     (hemanth.kothuru@nxtwave.co.in)
-- New POC : Satti Suresh Reddy  (satti.sureshreddy@nxtwave.co.in)
-- Date    : 2026-05-20
-- Idempotent: safe to run multiple times on any environment
-- ============================================================

DO $$
DECLARE
  v_tenant_id     uuid;
  v_team_id       uuid;
  v_old_poc_email text := 'hemanth.kothuru@nxtwave.co.in';
  v_new_poc_email text := 'satti.sureshreddy@nxtwave.co.in';
  v_new_poc_name  text := 'Satti Suresh Reddy';
  v_employee_id   text := 'NW0005535';
  v_team_name     text := 'Finance Operations';
BEGIN

  -- Resolve tenant dynamically (no hardcoded UUIDs)
  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE deleted_at IS NULL
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No active tenant found';
  END IF;

  -- Resolve team dynamically by name
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE name = v_team_name
    AND deleted_at IS NULL
    AND tenant_id = v_tenant_id
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Team "%" not found', v_team_name;
  END IF;

  -- Step 1: Add to users (idempotent via ON CONFLICT)
  -- Unique constraint: (tenant_id, email)
  INSERT INTO public.users (tenant_id, email, full_name, role, team_id, is_active, password_hash)
  VALUES (v_tenant_id, v_new_poc_email, v_new_poc_name, 'POC', v_team_id, true, NULL)
  ON CONFLICT (tenant_id, email) DO UPDATE
    SET full_name  = EXCLUDED.full_name,
        role       = EXCLUDED.role,
        team_id    = EXCLUDED.team_id,
        is_active  = true,
        updated_at = now();

  -- Step 2: Add to employees (idempotent via ON CONFLICT on employee_id)
  INSERT INTO public.employees (employee_id, email, full_name, tenant_id, is_active, role)
  VALUES (v_employee_id, v_new_poc_email, v_new_poc_name, v_tenant_id, true, 'viewer')
  ON CONFLICT (employee_id) DO NOTHING;

  -- Step 3: Retire old POC mapping (safe to re-run — WHERE guards it)
  UPDATE public.team_role_mappings
  SET active_flag = false,
      replaced_at = now(),
      updated_at  = now()
  WHERE team_id    = v_team_id
    AND tenant_id  = v_tenant_id
    AND role_type  = 'POC'
    AND email      = v_old_poc_email
    AND active_flag = true
    AND deleted_at IS NULL;

  -- Step 4: Add new POC mapping (idempotent via ON CONFLICT)
  -- Unique constraint: (tenant_id, team_id, email, role_type)
  INSERT INTO public.team_role_mappings
    (tenant_id, team_id, email, role_type, active_flag, assigned_at, created_at, updated_at)
  VALUES
    (v_tenant_id, v_team_id, v_new_poc_email, 'POC', true, now(), now(), now())
  ON CONFLICT (tenant_id, team_id, email, role_type) DO UPDATE
    SET active_flag = true,
        updated_at  = now();

  -- Step 5: Update denormalized POC fields on teams (UPDATE is always idempotent)
  UPDATE public.teams
  SET poc_name   = v_new_poc_name,
      poc_email  = v_new_poc_email,
      updated_at = now()
  WHERE id        = v_team_id
    AND tenant_id = v_tenant_id;

END $$;
