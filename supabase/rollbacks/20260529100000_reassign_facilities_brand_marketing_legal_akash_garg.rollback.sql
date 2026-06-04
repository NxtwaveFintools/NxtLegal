-- ============================================================
-- ROLLBACK for: 20260529100000_reassign_facilities_brand_marketing_legal_akash_garg.sql
-- Restores the legal owners that were active before the reassignment:
--   Facilities      -> Deepika Yadav (yadav.deepika@nxtwave.co.in)
--   Brand Marketing -> Vidushi Jha   (vidushi.jha@nxtwave.co.in)
-- and retires Akash Garg from those two departments.
-- Date     : 2026-05-29
-- Idempotent: safe to run multiple times on any environment
-- NOTE     : This is a manual rollback script (not auto-applied by the
--            migration runner). Run it explicitly to revert.
-- ============================================================

DO $$
DECLARE
  v_tenant_id     uuid;
  v_legal_email   text := 'akash.garg@nxtwave.co.in';
  v_legal_user_id uuid;
  -- (team_name, original_owner_email) pairs
  v_pairs         text[][] := ARRAY[
                                ARRAY['Facilities',      'yadav.deepika@nxtwave.co.in'],
                                ARRAY['Brand Marketing', 'vidushi.jha@nxtwave.co.in']
                              ];
  v_team_name     text;
  v_owner_email   text;
  v_team_id       uuid;
  v_owner_user_id uuid;
  i               int;
BEGIN

  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE deleted_at IS NULL
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No active tenant found';
  END IF;

  SELECT id INTO v_legal_user_id
  FROM public.users
  WHERE email = v_legal_email
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_legal_user_id IS NULL THEN
    RAISE EXCEPTION 'Legal user "%" not found', v_legal_email;
  END IF;

  FOR i IN 1 .. array_length(v_pairs, 1)
  LOOP
    v_team_name   := v_pairs[i][1];
    v_owner_email := v_pairs[i][2];

    SELECT id INTO v_team_id
    FROM public.teams
    WHERE name = v_team_name
      AND deleted_at IS NULL
      AND tenant_id = v_tenant_id
    LIMIT 1;

    IF v_team_id IS NULL THEN
      RAISE EXCEPTION 'Team "%" not found', v_team_name;
    END IF;

    SELECT id INTO v_owner_user_id
    FROM public.users
    WHERE email = v_owner_email
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_owner_user_id IS NULL THEN
      RAISE EXCEPTION 'Original owner "%" not found', v_owner_email;
    END IF;

    -- Step 1: Retire Akash from this department.
    UPDATE public.department_legal_assignments
    SET is_active  = false,
        revoked_at = now(),
        updated_at = now()
    WHERE tenant_id     = v_tenant_id
      AND department_id = v_team_id
      AND user_id       = v_legal_user_id
      AND is_active      = true
      AND deleted_at IS NULL;

    -- Step 2: Restore the original legal owner (idempotent via ON CONFLICT).
    INSERT INTO public.department_legal_assignments
      (tenant_id, department_id, user_id, is_active, assigned_at, created_at, updated_at)
    VALUES
      (v_tenant_id, v_team_id, v_owner_user_id, true, now(), now(), now())
    ON CONFLICT (tenant_id, department_id, user_id) DO UPDATE
      SET is_active   = true,
          revoked_at  = NULL,
          revoked_by  = NULL,
          deleted_at  = NULL,
          assigned_at = now(),
          updated_at  = now();
  END LOOP;

END $$;
