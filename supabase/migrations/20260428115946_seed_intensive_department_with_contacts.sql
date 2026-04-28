DO $$
DECLARE
  v_tenant_id UUID := '00000000-0000-0000-0000-000000000000';
  v_now TIMESTAMPTZ := NOW();
  v_users_has_team_id BOOLEAN := FALSE;
  v_team_name TEXT := 'Intensive';
  v_hod_name TEXT := 'Aniketh Reddy Mastoor';
  v_hod_email TEXT := 'aniketh@nxtwave.co.in';
  v_poc_name TEXT := 'Sobha Rani Potnuru';
  v_poc_email TEXT := 'sobharani@nxtwave.tech';
  v_team_id UUID;
  v_hod_user_id UUID;
  v_poc_user_id UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'users'
      AND c.column_name = 'team_id'
  )
  INTO v_users_has_team_id;

  SELECT t.id
  INTO v_team_id
  FROM public.teams t
  WHERE t.tenant_id = v_tenant_id
    AND LOWER(TRIM(t.name)) = LOWER(v_team_name)
  ORDER BY t.created_at DESC, t.id DESC
  LIMIT 1;

  IF v_team_id IS NULL THEN
    INSERT INTO public.teams (
      tenant_id,
      name,
      poc_email,
      hod_email,
      poc_name,
      hod_name,
      is_active,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      v_tenant_id,
      v_team_name,
      v_poc_email,
      v_hod_email,
      v_poc_name,
      v_hod_name,
      TRUE,
      v_now,
      v_now,
      NULL
    )
    RETURNING id INTO v_team_id;
  ELSE
    UPDATE public.teams
    SET
      name = v_team_name,
      poc_email = v_poc_email,
      hod_email = v_hod_email,
      poc_name = v_poc_name,
      hod_name = v_hod_name,
      is_active = TRUE,
      updated_at = v_now,
      deleted_at = NULL
    WHERE id = v_team_id;
  END IF;

  SELECT u.id
  INTO v_hod_user_id
  FROM public.users u
  WHERE u.tenant_id = v_tenant_id
    AND LOWER(TRIM(u.email)) = v_hod_email
  ORDER BY u.created_at DESC, u.id DESC
  LIMIT 1;

  IF v_hod_user_id IS NULL THEN
    IF v_users_has_team_id THEN
      INSERT INTO public.users (
        tenant_id,
        email,
        full_name,
        password_hash,
        role,
        team_id,
        is_active,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        v_tenant_id,
        v_hod_email,
        v_hod_name,
        NULL,
        'HOD',
        v_team_id,
        TRUE,
        v_now,
        v_now,
        NULL
      )
      RETURNING id INTO v_hod_user_id;
    ELSE
      INSERT INTO public.users (
        tenant_id,
        email,
        full_name,
        password_hash,
        role,
        is_active,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        v_tenant_id,
        v_hod_email,
        v_hod_name,
        NULL,
        'HOD',
        TRUE,
        v_now,
        v_now,
        NULL
      )
      RETURNING id INTO v_hod_user_id;
    END IF;
  ELSE
    IF v_users_has_team_id THEN
      UPDATE public.users
      SET
        email = v_hod_email,
        full_name = v_hod_name,
        password_hash = NULL,
        role = 'HOD',
        team_id = v_team_id,
        is_active = TRUE,
        updated_at = v_now,
        deleted_at = NULL
      WHERE id = v_hod_user_id;
    ELSE
      UPDATE public.users
      SET
        email = v_hod_email,
        full_name = v_hod_name,
        password_hash = NULL,
        role = 'HOD',
        is_active = TRUE,
        updated_at = v_now,
        deleted_at = NULL
      WHERE id = v_hod_user_id;
    END IF;
  END IF;

  SELECT u.id
  INTO v_poc_user_id
  FROM public.users u
  WHERE u.tenant_id = v_tenant_id
    AND LOWER(TRIM(u.email)) = v_poc_email
  ORDER BY u.created_at DESC, u.id DESC
  LIMIT 1;

  IF v_poc_user_id IS NULL THEN
    IF v_users_has_team_id THEN
      INSERT INTO public.users (
        tenant_id,
        email,
        full_name,
        password_hash,
        role,
        team_id,
        is_active,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        v_tenant_id,
        v_poc_email,
        v_poc_name,
        NULL,
        'POC',
        v_team_id,
        TRUE,
        v_now,
        v_now,
        NULL
      )
      RETURNING id INTO v_poc_user_id;
    ELSE
      INSERT INTO public.users (
        tenant_id,
        email,
        full_name,
        password_hash,
        role,
        is_active,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        v_tenant_id,
        v_poc_email,
        v_poc_name,
        NULL,
        'POC',
        TRUE,
        v_now,
        v_now,
        NULL
      )
      RETURNING id INTO v_poc_user_id;
    END IF;
  ELSE
    IF v_users_has_team_id THEN
      UPDATE public.users
      SET
        email = v_poc_email,
        full_name = v_poc_name,
        password_hash = NULL,
        role = 'POC',
        team_id = v_team_id,
        is_active = TRUE,
        updated_at = v_now,
        deleted_at = NULL
      WHERE id = v_poc_user_id;
    ELSE
      UPDATE public.users
      SET
        email = v_poc_email,
        full_name = v_poc_name,
        password_hash = NULL,
        role = 'POC',
        is_active = TRUE,
        updated_at = v_now,
        deleted_at = NULL
      WHERE id = v_poc_user_id;
    END IF;
  END IF;

  UPDATE public.team_role_mappings trm
  SET
    active_flag = FALSE,
    replaced_by = v_hod_user_id,
    replaced_at = v_now,
    updated_at = v_now,
    deleted_at = COALESCE(trm.deleted_at, v_now)
  WHERE trm.tenant_id = v_tenant_id
    AND trm.team_id = v_team_id
    AND trm.role_type = 'HOD'
    AND trm.active_flag = TRUE
    AND LOWER(TRIM(trm.email)) <> v_hod_email;

  UPDATE public.team_role_mappings trm
  SET
    active_flag = TRUE,
    assigned_by = COALESCE(trm.assigned_by, v_hod_user_id),
    assigned_at = COALESCE(trm.assigned_at, v_now),
    replaced_by = NULL,
    replaced_at = NULL,
    updated_at = v_now,
    deleted_at = NULL
  WHERE trm.tenant_id = v_tenant_id
    AND trm.team_id = v_team_id
    AND trm.role_type = 'HOD'
    AND LOWER(TRIM(trm.email)) = v_hod_email;

  IF NOT FOUND THEN
    INSERT INTO public.team_role_mappings (
      tenant_id,
      team_id,
      email,
      role_type,
      active_flag,
      assigned_by,
      assigned_at,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      v_tenant_id,
      v_team_id,
      v_hod_email,
      'HOD',
      TRUE,
      v_hod_user_id,
      v_now,
      v_now,
      v_now,
      NULL
    );
  END IF;

  UPDATE public.team_role_mappings trm
  SET
    active_flag = FALSE,
    replaced_by = v_poc_user_id,
    replaced_at = v_now,
    updated_at = v_now,
    deleted_at = COALESCE(trm.deleted_at, v_now)
  WHERE trm.tenant_id = v_tenant_id
    AND trm.team_id = v_team_id
    AND trm.role_type = 'POC'
    AND trm.active_flag = TRUE
    AND LOWER(TRIM(trm.email)) <> v_poc_email;

  UPDATE public.team_role_mappings trm
  SET
    active_flag = TRUE,
    assigned_by = COALESCE(trm.assigned_by, v_poc_user_id),
    assigned_at = COALESCE(trm.assigned_at, v_now),
    replaced_by = NULL,
    replaced_at = NULL,
    updated_at = v_now,
    deleted_at = NULL
  WHERE trm.tenant_id = v_tenant_id
    AND trm.team_id = v_team_id
    AND trm.role_type = 'POC'
    AND LOWER(TRIM(trm.email)) = v_poc_email;

  IF NOT FOUND THEN
    INSERT INTO public.team_role_mappings (
      tenant_id,
      team_id,
      email,
      role_type,
      active_flag,
      assigned_by,
      assigned_at,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      v_tenant_id,
      v_team_id,
      v_poc_email,
      'POC',
      TRUE,
      v_poc_user_id,
      v_now,
      v_now,
      v_now,
      NULL
    );
  END IF;
END;
$$;
