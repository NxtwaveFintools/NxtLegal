-- Update Shanker email from nxtwave.tech to nxtwave.co.in across role-resolution tables.
DO $$
DECLARE
  v_old_email CONSTANT TEXT := 'shanker@nxtwave.tech';
  v_new_email CONSTANT TEXT := 'shanker@nxtwave.co.in';
BEGIN
  -- Keep teams as source-of-truth for HOD/POC routing.
  UPDATE public.teams t
  SET hod_email = v_new_email
  WHERE lower(trim(t.hod_email)) = v_old_email;

  UPDATE public.teams t
  SET poc_email = v_new_email
  WHERE lower(trim(t.poc_email)) = v_old_email;

  -- Handle duplicate role mappings first to avoid unique key conflicts.
  UPDATE public.team_role_mappings old_trm
  SET
    active_flag = FALSE,
    replaced_at = COALESCE(old_trm.replaced_at, NOW()),
    updated_at = NOW(),
    deleted_at = COALESCE(old_trm.deleted_at, NOW())
  WHERE lower(trim(old_trm.email)) = v_old_email
    AND EXISTS (
      SELECT 1
      FROM public.team_role_mappings new_trm
      WHERE new_trm.tenant_id = old_trm.tenant_id
        AND new_trm.team_id = old_trm.team_id
        AND new_trm.role_type = old_trm.role_type
        AND lower(trim(new_trm.email)) = v_new_email
        AND new_trm.id <> old_trm.id
    );

  UPDATE public.team_role_mappings trm
  SET
    email = v_new_email,
    updated_at = NOW(),
    deleted_at = NULL
  WHERE lower(trim(trm.email)) = v_old_email
    AND NOT EXISTS (
      SELECT 1
      FROM public.team_role_mappings trm_conflict
      WHERE trm_conflict.tenant_id = trm.tenant_id
        AND trm_conflict.team_id = trm.team_id
        AND trm_conflict.role_type = trm.role_type
        AND lower(trim(trm_conflict.email)) = v_new_email
        AND trm_conflict.id <> trm.id
    );

  -- Update users used by runtime role-resolution and login.
  UPDATE public.users u
  SET
    email = v_new_email,
    updated_at = NOW(),
    deleted_at = NULL
  WHERE lower(trim(u.email)) = v_old_email
    AND NOT EXISTS (
      SELECT 1
      FROM public.users u2
      WHERE u2.tenant_id = u.tenant_id
        AND lower(trim(u2.email)) = v_new_email
        AND u2.id <> u.id
    );

  -- Keep employees aligned where present.
  UPDATE public.employees e
  SET
    email = v_new_email,
    updated_at = NOW()
  WHERE lower(trim(e.email)) = v_old_email
    AND NOT EXISTS (
      SELECT 1
      FROM public.employees e2
      WHERE lower(trim(e2.email)) = v_new_email
        AND COALESCE(e2.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(e.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND e2.employee_id <> e.employee_id
    );
END;
$$;
