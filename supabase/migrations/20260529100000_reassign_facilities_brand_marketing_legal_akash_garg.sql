-- ============================================================
-- Migration: Reassign legal owner for Facilities & Brand Marketing
-- Teams    : Facilities (was Deepika Yadav)
--            Brand Marketing (was Vidushi Jha)
-- New owner: Akash Garg (akash.garg@nxtwave.co.in, NW0004980)
-- Effect   : Tasks raised from these teams are now assigned to Akash.
-- Date     : 2026-05-29
-- Idempotent: safe to run multiple times on any environment
-- Rollback : 20260529100000_reassign_facilities_brand_marketing_legal_akash_garg.rollback.sql
-- ============================================================

DO $$
DECLARE
  v_tenant_id      uuid;
  v_legal_email    text := 'akash.garg@nxtwave.co.in';
  v_legal_user_id  uuid;
  v_team_names     text[] := ARRAY['Facilities', 'Brand Marketing'];
  v_team_name      text;
  v_team_id        uuid;
BEGIN

  -- Resolve tenant dynamically (no hardcoded UUIDs)
  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE deleted_at IS NULL
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No active tenant found';
  END IF;

  -- Resolve the legal user (must already exist as a LEGAL_TEAM member)
  SELECT id INTO v_legal_user_id
  FROM public.users
  WHERE email = v_legal_email
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_legal_user_id IS NULL THEN
    RAISE EXCEPTION 'Legal user "%" not found', v_legal_email;
  END IF;

  FOREACH v_team_name IN ARRAY v_team_names
  LOOP
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

    -- Step 1: Retire any other active legal owner(s) for this department.
    -- (App reads WHERE is_active = true AND deleted_at IS NULL.)
    UPDATE public.department_legal_assignments
    SET is_active  = false,
        revoked_at = now(),
        updated_at = now()
    WHERE tenant_id     = v_tenant_id
      AND department_id = v_team_id
      AND user_id      <> v_legal_user_id
      AND is_active      = true
      AND deleted_at IS NULL;

    -- Step 2: Activate Akash as the legal owner (idempotent via ON CONFLICT).
    -- Unique constraint: (tenant_id, department_id, user_id)
    INSERT INTO public.department_legal_assignments
      (tenant_id, department_id, user_id, is_active, assigned_at, created_at, updated_at)
    VALUES
      (v_tenant_id, v_team_id, v_legal_user_id, true, now(), now(), now())
    ON CONFLICT (tenant_id, department_id, user_id) DO UPDATE
      SET is_active   = true,
          revoked_at  = NULL,
          revoked_by  = NULL,
          deleted_at  = NULL,
          assigned_at = now(),
          updated_at  = now();
  END LOOP;

END $$;
