-- Email-based team governance mappings for Microsoft SSO lazy provisioning

CREATE TABLE IF NOT EXISTS public.team_role_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role_type TEXT NOT NULL CHECK (role_type IN ('POC', 'HOD')),
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replaced_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  replaced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'team_role_mappings_tenant_team_email_role_unique'
      AND conrelid = 'public.team_role_mappings'::regclass
  ) THEN
    ALTER TABLE public.team_role_mappings
      ADD CONSTRAINT team_role_mappings_tenant_team_email_role_unique
      UNIQUE (tenant_id, team_id, email, role_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_team_role_mappings_tenant_team
  ON public.team_role_mappings (tenant_id, team_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_team_role_mappings_tenant_email
  ON public.team_role_mappings (tenant_id, lower(email))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_role_mappings_active_role_unique
  ON public.team_role_mappings (tenant_id, team_id, role_type)
  WHERE active_flag = TRUE AND deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'team_role_mappings'
      AND trigger_name = 'update_team_role_mappings_updated_at'
  ) THEN
    CREATE TRIGGER update_team_role_mappings_updated_at
      BEFORE UPDATE ON public.team_role_mappings
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.team_role_mappings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'team_role_mappings'
      AND policyname = 'team_role_mappings_tenant_isolation'
  ) THEN
    CREATE POLICY "team_role_mappings_tenant_isolation" ON public.team_role_mappings
      FOR ALL
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
      WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
  END IF;
END $$;

INSERT INTO public.team_role_mappings (tenant_id, team_id, email, role_type, active_flag, assigned_at)
SELECT t.tenant_id, t.id, lower(trim(t.poc_email)), 'POC', TRUE, NOW()
FROM public.teams t
WHERE t.poc_email IS NOT NULL
  AND trim(t.poc_email) <> ''
ON CONFLICT (tenant_id, team_id, email, role_type)
DO UPDATE SET
  active_flag = TRUE,
  deleted_at = NULL,
  updated_at = NOW();

INSERT INTO public.team_role_mappings (tenant_id, team_id, email, role_type, active_flag, assigned_at)
SELECT t.tenant_id, t.id, lower(trim(t.hod_email)), 'HOD', TRUE, NOW()
FROM public.teams t
WHERE t.hod_email IS NOT NULL
  AND trim(t.hod_email) <> ''
ON CONFLICT (tenant_id, team_id, email, role_type)
DO UPDATE SET
  active_flag = TRUE,
  deleted_at = NULL,
  updated_at = NOW();

INSERT INTO public.team_role_mappings (tenant_id, team_id, email, role_type, active_flag, assigned_at)
SELECT tm.tenant_id, tm.team_id, lower(trim(u.email)), tm.role_type, TRUE, NOW()
FROM public.team_members tm
JOIN public.users u
  ON u.id = tm.user_id
 AND u.tenant_id = tm.tenant_id
WHERE tm.is_primary = TRUE
  AND tm.role_type IN ('POC', 'HOD')
  AND u.email IS NOT NULL
  AND trim(u.email) <> ''
ON CONFLICT (tenant_id, team_id, email, role_type)
DO UPDATE SET
  active_flag = TRUE,
  deleted_at = NULL,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.admin_create_department_with_emails(
  p_tenant_id UUID,
  p_admin_user_id UUID,
  p_department_name TEXT,
  p_poc_email TEXT,
  p_hod_email TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  team_id UUID,
  department_name TEXT,
  is_active BOOLEAN,
  poc_email TEXT,
  hod_email TEXT,
  before_state_snapshot JSONB,
  after_state_snapshot JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_team_id UUID;
  v_admin_email TEXT;
  v_admin_role TEXT;
  v_normalized_poc_email TEXT := lower(trim(COALESCE(p_poc_email, '')));
  v_normalized_hod_email TEXT := lower(trim(COALESCE(p_hod_email, '')));
  v_before JSONB := jsonb_build_object('department', NULL, 'mappings', '[]'::jsonb);
  v_after JSONB;
BEGIN
  IF p_tenant_id IS NULL OR p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Tenant and admin user are required';
  END IF;

  IF p_department_name IS NULL OR btrim(p_department_name) = '' THEN
    RAISE EXCEPTION 'Department name is required';
  END IF;

  IF v_normalized_poc_email = '' OR v_normalized_hod_email = '' THEN
    RAISE EXCEPTION 'POC and HOD email are required';
  END IF;

  IF v_normalized_poc_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
    OR v_normalized_hod_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  IF v_normalized_poc_email = v_normalized_hod_email THEN
    RAISE EXCEPTION 'POC and HOD emails must be different';
  END IF;

  SELECT email, role
    INTO v_admin_email, v_admin_role
  FROM public.users
  WHERE id = p_admin_user_id
    AND tenant_id = p_tenant_id
    AND is_active = TRUE
    AND deleted_at IS NULL;

  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Admin user not found in tenant context';
  END IF;

  INSERT INTO public.teams (tenant_id, name, poc_email, hod_email, is_active, deleted_at)
  VALUES (p_tenant_id, btrim(p_department_name), v_normalized_poc_email, v_normalized_hod_email, TRUE, NULL)
  RETURNING id INTO v_team_id;

  INSERT INTO public.team_role_mappings (
    tenant_id,
    team_id,
    email,
    role_type,
    active_flag,
    assigned_by,
    assigned_at,
    deleted_at
  ) VALUES
    (p_tenant_id, v_team_id, v_normalized_poc_email, 'POC', TRUE, p_admin_user_id, NOW(), NULL),
    (p_tenant_id, v_team_id, v_normalized_hod_email, 'HOD', TRUE, p_admin_user_id, NOW(), NULL)
  ON CONFLICT (tenant_id, team_id, email, role_type)
  DO UPDATE SET
    active_flag = TRUE,
    assigned_by = p_admin_user_id,
    assigned_at = NOW(),
    replaced_by = NULL,
    replaced_at = NULL,
    deleted_at = NULL,
    updated_at = NOW();

  v_after := jsonb_build_object(
    'department', jsonb_build_object(
      'id', v_team_id,
      'name', btrim(p_department_name),
      'is_active', TRUE,
      'poc_email', v_normalized_poc_email,
      'hod_email', v_normalized_hod_email
    ),
    'mappings', jsonb_build_array(
      jsonb_build_object('role_type', 'POC', 'email', v_normalized_poc_email),
      jsonb_build_object('role_type', 'HOD', 'email', v_normalized_hod_email)
    )
  );

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource_type,
    resource_id,
    changes,
    metadata,
    actor_email,
    actor_role
  ) VALUES
    (
      p_tenant_id,
      p_admin_user_id::TEXT,
      'team.created',
      'team',
      v_team_id::TEXT,
      jsonb_build_object('before_state_snapshot', v_before, 'after_state_snapshot', v_after),
      jsonb_build_object('reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'department_name', btrim(p_department_name)),
      v_admin_email,
      v_admin_role
    ),
    (
      p_tenant_id,
      p_admin_user_id::TEXT,
      'team.poc.assigned',
      'team_role_mappings',
      v_team_id::TEXT,
      jsonb_build_object('old_email', NULL, 'new_email', v_normalized_poc_email, 'role_type', 'POC'),
      jsonb_build_object('reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'team_name', btrim(p_department_name)),
      v_admin_email,
      v_admin_role
    ),
    (
      p_tenant_id,
      p_admin_user_id::TEXT,
      'team.hod.assigned',
      'team_role_mappings',
      v_team_id::TEXT,
      jsonb_build_object('old_email', NULL, 'new_email', v_normalized_hod_email, 'role_type', 'HOD'),
      jsonb_build_object('reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'team_name', btrim(p_department_name)),
      v_admin_email,
      v_admin_role
    );

  RETURN QUERY
  SELECT v_team_id, btrim(p_department_name), TRUE, v_normalized_poc_email, v_normalized_hod_email, v_before, v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_replace_team_role_email(
  p_tenant_id UUID,
  p_admin_user_id UUID,
  p_team_id UUID,
  p_role_type TEXT,
  p_new_email TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  team_id UUID,
  role_type TEXT,
  previous_email TEXT,
  next_email TEXT,
  before_state_snapshot JSONB,
  after_state_snapshot JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin_email TEXT;
  v_admin_role TEXT;
  v_role_type TEXT := UPPER(TRIM(COALESCE(p_role_type, '')));
  v_normalized_new_email TEXT := lower(trim(COALESCE(p_new_email, '')));
  v_previous_email TEXT;
  v_other_role TEXT;
  v_other_role_email TEXT;
  v_before JSONB;
  v_after JSONB;
BEGIN
  IF p_tenant_id IS NULL OR p_admin_user_id IS NULL OR p_team_id IS NULL THEN
    RAISE EXCEPTION 'Tenant, admin user, and team are required';
  END IF;

  IF v_role_type NOT IN ('POC', 'HOD') THEN
    RAISE EXCEPTION 'Role type must be POC or HOD';
  END IF;

  IF v_normalized_new_email = '' THEN
    RAISE EXCEPTION 'New email is required';
  END IF;

  IF v_normalized_new_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  SELECT email, role
    INTO v_admin_email, v_admin_role
  FROM public.users
  WHERE id = p_admin_user_id
    AND tenant_id = p_tenant_id
    AND is_active = TRUE
    AND deleted_at IS NULL;

  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Admin user not found in tenant context';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = p_team_id
      AND t.tenant_id = p_tenant_id
      AND t.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Department not found in tenant context';
  END IF;

  SELECT trm.email
    INTO v_previous_email
  FROM public.team_role_mappings trm
  WHERE trm.tenant_id = p_tenant_id
    AND trm.team_id = p_team_id
    AND trm.role_type = v_role_type
    AND trm.active_flag = TRUE
    AND trm.deleted_at IS NULL
  LIMIT 1;

  IF v_previous_email IS NULL THEN
    RAISE EXCEPTION 'Cannot remove primary role without assigning replacement';
  END IF;

  v_other_role := CASE WHEN v_role_type = 'POC' THEN 'HOD' ELSE 'POC' END;

  SELECT trm.email
    INTO v_other_role_email
  FROM public.team_role_mappings trm
  WHERE trm.tenant_id = p_tenant_id
    AND trm.team_id = p_team_id
    AND trm.role_type = v_other_role
    AND trm.active_flag = TRUE
    AND trm.deleted_at IS NULL
  LIMIT 1;

  IF v_other_role_email IS NOT NULL AND v_other_role_email = v_normalized_new_email THEN
    RAISE EXCEPTION 'POC and HOD emails must be different';
  END IF;

  v_before := jsonb_build_object(
    'role_type', v_role_type,
    'old_email', v_previous_email,
    'new_email', v_normalized_new_email
  );

  UPDATE public.team_role_mappings
  SET active_flag = FALSE,
      replaced_by = p_admin_user_id,
      replaced_at = NOW(),
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND team_id = p_team_id
    AND role_type = v_role_type
    AND active_flag = TRUE
    AND deleted_at IS NULL;

  INSERT INTO public.team_role_mappings (
    tenant_id,
    team_id,
    email,
    role_type,
    active_flag,
    assigned_by,
    assigned_at,
    replaced_by,
    replaced_at,
    deleted_at
  ) VALUES (
    p_tenant_id,
    p_team_id,
    v_normalized_new_email,
    v_role_type,
    TRUE,
    p_admin_user_id,
    NOW(),
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (tenant_id, team_id, email, role_type)
  DO UPDATE SET
    active_flag = TRUE,
    assigned_by = p_admin_user_id,
    assigned_at = NOW(),
    replaced_by = NULL,
    replaced_at = NULL,
    deleted_at = NULL,
    updated_at = NOW();

  UPDATE public.teams
  SET poc_email = CASE WHEN v_role_type = 'POC' THEN v_normalized_new_email ELSE poc_email END,
      hod_email = CASE WHEN v_role_type = 'HOD' THEN v_normalized_new_email ELSE hod_email END,
      updated_at = NOW()
  WHERE id = p_team_id
    AND tenant_id = p_tenant_id;

  v_after := jsonb_build_object(
    'role_type', v_role_type,
    'old_email', v_previous_email,
    'new_email', v_normalized_new_email
  );

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource_type,
    resource_id,
    changes,
    metadata,
    actor_email,
    actor_role
  ) VALUES (
    p_tenant_id,
    p_admin_user_id::TEXT,
    CASE WHEN v_role_type = 'POC' THEN 'team.poc.replaced' ELSE 'team.hod.replaced' END,
    'team_role_mappings',
    p_team_id::TEXT,
    jsonb_build_object('before_state_snapshot', v_before, 'after_state_snapshot', v_after),
    jsonb_build_object('reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'role_type', v_role_type),
    v_admin_email,
    v_admin_role
  );

  RETURN QUERY
  SELECT p_team_id, v_role_type, v_previous_email, v_normalized_new_email, v_before, v_after;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_department_with_emails(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_replace_team_role_email(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_create_department_with_emails(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_replace_team_role_email(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO service_role;