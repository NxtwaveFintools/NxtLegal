


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."audit_event_type" AS ENUM (
    'CONTRACT_CREATED',
    'CONTRACT_TRANSITIONED',
    'CONTRACT_APPROVED',
    'CONTRACT_BYPASSED',
    'CONTRACT_NOTE_ADDED',
    'CONTRACT_APPROVER_ADDED',
    'CONTRACT_APPROVER_APPROVED',
    'TEAM_MEMBER_REASSIGNED',
    'CONTRACT_APPROVER_REJECTED',
    'CONTRACT_SIGNATORY_ADDED',
    'CONTRACT_SIGNATORY_SENT',
    'CONTRACT_SIGNATORY_DELIVERED',
    'CONTRACT_SIGNATORY_VIEWED',
    'CONTRACT_SIGNATORY_SIGNED',
    'CONTRACT_SIGNATORY_COMPLETED',
    'CONTRACT_SIGNATORY_DECLINED',
    'CONTRACT_SIGNATORY_EXPIRED',
    'CONTRACT_ASSIGNEE_SET',
    'CONTRACT_COLLABORATOR_ADDED',
    'CONTRACT_COLLABORATOR_REMOVED',
    'CONTRACT_ACTIVITY_MESSAGE_ADDED',
    'CONTRACT_APPROVER_BYPASSED'
);


ALTER TYPE "public"."audit_event_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_assign_primary_team_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("team_id" "uuid", "role_type" "text", "previous_user_id" "uuid", "next_user_id" "uuid", "affected_contracts" bigint, "before_state_snapshot" "jsonb", "after_state_snapshot" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role_type TEXT := UPPER(TRIM(COALESCE(p_role_type, '')));
  v_admin_email TEXT;
  v_admin_role TEXT;
  v_prev_user_id UUID;
  v_prev_email TEXT;
  v_next_email TEXT;
  v_before JSONB;
  v_after JSONB;
  v_affected BIGINT := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_admin_user_id IS NULL OR p_team_id IS NULL OR p_new_user_id IS NULL THEN
    RAISE EXCEPTION 'Tenant, admin user, team, and new user are required';
  END IF;

  IF v_role_type NOT IN ('POC', 'HOD') THEN
    RAISE EXCEPTION 'Role type must be POC or HOD';
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

  SELECT tm.user_id, u.email
    INTO v_prev_user_id, v_prev_email
  FROM public.team_members tm
  LEFT JOIN public.users u
    ON u.id = tm.user_id
   AND u.tenant_id = tm.tenant_id
  WHERE tm.tenant_id = p_tenant_id
    AND tm.team_id = p_team_id
    AND tm.role_type = v_role_type
    AND tm.is_primary = TRUE
  LIMIT 1;

  SELECT email INTO v_next_email
  FROM public.users
  WHERE id = p_new_user_id
    AND tenant_id = p_tenant_id
    AND is_active = TRUE
    AND deleted_at IS NULL;

  IF v_next_email IS NULL THEN
    RAISE EXCEPTION 'New assignee must be an active tenant user';
  END IF;

  v_before := jsonb_build_object(
    'role_type', v_role_type,
    'team_id', p_team_id,
    'user_id', v_prev_user_id,
    'user_email', v_prev_email
  );

  PERFORM *
  FROM public.replace_primary_team_member(
    p_tenant_id,
    p_team_id,
    p_new_user_id,
    v_role_type,
    p_admin_user_id::TEXT,
    v_admin_email,
    v_admin_role
  );

  IF v_role_type = 'POC' THEN
    SELECT COUNT(*)::BIGINT
      INTO v_affected
    FROM public.contracts c
    WHERE c.tenant_id = p_tenant_id
      AND c.deleted_at IS NULL
      AND c.uploaded_by_employee_id = p_new_user_id::TEXT;
  ELSE
    SELECT COUNT(*)::BIGINT
      INTO v_affected
    FROM public.contracts c
    WHERE c.tenant_id = p_tenant_id
      AND c.deleted_at IS NULL
      AND c.status = 'HOD_PENDING'
      AND c.current_assignee_employee_id = p_new_user_id::TEXT;
  END IF;

  v_after := jsonb_build_object(
    'role_type', v_role_type,
    'team_id', p_team_id,
    'user_id', p_new_user_id,
    'user_email', v_next_email,
    'affected_contracts', v_affected
  );

  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, changes, metadata, actor_email, actor_role, target_email
  ) VALUES (
    p_tenant_id,
    p_admin_user_id::TEXT,
    'team.primary_role.updated',
    'team_member',
    p_team_id::TEXT,
    jsonb_build_object('before_state_snapshot', v_before, 'after_state_snapshot', v_after),
    jsonb_build_object('reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'role_type', v_role_type),
    v_admin_email,
    v_admin_role,
    v_next_email
  );

  RETURN QUERY
  SELECT p_team_id, v_role_type, v_prev_user_id, p_new_user_id, v_affected, v_before, v_after;
END;
$$;


ALTER FUNCTION "public"."admin_assign_primary_team_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_change_user_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_target_user_id" "uuid", "p_role_key" "text", "p_operation" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("changed" boolean, "operation" "text", "role_key" "text", "target_user_id" "uuid", "target_email" "text", "before_state_snapshot" "jsonb", "after_state_snapshot" "jsonb", "old_token_version" integer, "new_token_version" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role_id UUID;
  v_role_key TEXT;
  v_target_email TEXT;
  v_before_roles JSONB := '[]'::JSONB;
  v_after_roles JSONB := '[]'::JSONB;
  v_old_token_version INTEGER := 0;
  v_new_token_version INTEGER := 0;
  v_changed BOOLEAN := FALSE;
  v_row_count BIGINT := 0;
  v_operation TEXT := UPPER(TRIM(COALESCE(p_operation, '')));
  v_before_snapshot JSONB;
  v_after_snapshot JSONB;
BEGIN
  IF p_tenant_id IS NULL OR p_admin_user_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Tenant, admin user, and target user are required';
  END IF;

  IF p_role_key IS NULL OR btrim(p_role_key) = '' THEN
    RAISE EXCEPTION 'Role key is required';
  END IF;

  IF v_operation NOT IN ('GRANT', 'REVOKE') THEN
    RAISE EXCEPTION 'Operation must be GRANT or REVOKE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users admin_user
    WHERE admin_user.id = p_admin_user_id
      AND admin_user.tenant_id = p_tenant_id
      AND admin_user.is_active = TRUE
      AND admin_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Admin user not found in tenant context';
  END IF;

  SELECT u.email, COALESCE(u.token_version, 0)
    INTO v_target_email, v_old_token_version
  FROM public.users u
  WHERE u.id = p_target_user_id
    AND u.tenant_id = p_tenant_id
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL;

  IF v_target_email IS NULL THEN
    RAISE EXCEPTION 'Target user not found in tenant context';
  END IF;

  SELECT r.id, r.role_key
    INTO v_role_id, v_role_key
  FROM public.roles r
  WHERE r.tenant_id = p_tenant_id
    AND r.role_key = UPPER(TRIM(p_role_key))
    AND r.is_active = TRUE
    AND r.deleted_at IS NULL
  LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Role key % not found for tenant', UPPER(TRIM(p_role_key));
  END IF;

  SELECT COALESCE(jsonb_agg(DISTINCT r.role_key ORDER BY r.role_key), '[]'::JSONB)
    INTO v_before_roles
  FROM public.user_roles ur
  JOIN public.roles r
    ON r.id = ur.role_id
   AND r.tenant_id = ur.tenant_id
  WHERE ur.tenant_id = p_tenant_id
    AND ur.user_id = p_target_user_id
    AND ur.is_active = TRUE
    AND ur.deleted_at IS NULL
    AND r.deleted_at IS NULL
    AND r.is_active = TRUE;

  v_before_snapshot := jsonb_build_object(
    'role_keys', v_before_roles,
    'token_version', v_old_token_version
  );

  IF v_operation = 'GRANT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.tenant_id = p_tenant_id
        AND ur.user_id = p_target_user_id
        AND ur.role_id = v_role_id
        AND ur.is_active = TRUE
        AND ur.deleted_at IS NULL
    ) THEN
      INSERT INTO public.user_roles (
        tenant_id,
        user_id,
        role_id,
        is_active,
        assigned_by,
        assigned_at,
        revoked_by,
        revoked_at,
        deleted_at
      ) VALUES (
        p_tenant_id,
        p_target_user_id,
        v_role_id,
        TRUE,
        p_admin_user_id,
        NOW(),
        NULL,
        NULL,
        NULL
      );

      v_changed := TRUE;
    END IF;
  ELSE
    UPDATE public.user_roles ur
    SET
      is_active = FALSE,
      revoked_by = p_admin_user_id,
      revoked_at = NOW(),
      deleted_at = NOW()
    WHERE ur.tenant_id = p_tenant_id
      AND ur.user_id = p_target_user_id
      AND ur.role_id = v_role_id
      AND ur.is_active = TRUE
      AND ur.deleted_at IS NULL;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_changed := v_row_count > 0;
  END IF;

  IF v_changed THEN
    UPDATE public.users u
    SET
      token_version = COALESCE(u.token_version, 0) + 1,
      updated_at = NOW()
    WHERE u.id = p_target_user_id
      AND u.tenant_id = p_tenant_id
    RETURNING token_version INTO v_new_token_version;
  ELSE
    v_new_token_version := v_old_token_version;
  END IF;

  SELECT COALESCE(jsonb_agg(DISTINCT r.role_key ORDER BY r.role_key), '[]'::JSONB)
    INTO v_after_roles
  FROM public.user_roles ur
  JOIN public.roles r
    ON r.id = ur.role_id
   AND r.tenant_id = ur.tenant_id
  WHERE ur.tenant_id = p_tenant_id
    AND ur.user_id = p_target_user_id
    AND ur.is_active = TRUE
    AND ur.deleted_at IS NULL
    AND r.deleted_at IS NULL
    AND r.is_active = TRUE;

  v_after_snapshot := jsonb_build_object(
    'role_keys', v_after_roles,
    'token_version', v_new_token_version
  );

  IF v_changed THEN
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      action,
      resource_type,
      resource_id,
      changes,
      metadata,
      actor_email,
      actor_role,
      target_email
    ) VALUES (
      p_tenant_id,
      p_admin_user_id::TEXT,
      CASE WHEN v_operation = 'GRANT' THEN 'role.assigned' ELSE 'role.revoked' END,
      'user_role',
      p_target_user_id::TEXT,
      jsonb_build_object(
        'before_state_snapshot', v_before_snapshot,
        'after_state_snapshot', v_after_snapshot
      ),
      jsonb_build_object(
        'timestamp', NOW(),
        'admin_user_id', p_admin_user_id::TEXT,
        'action_type', CASE WHEN v_operation = 'GRANT' THEN 'role_assignment' ELSE 'role_revocation' END,
        'affected_user_id', p_target_user_id::TEXT,
        'affected_department_id', NULL,
        'role_key', v_role_key,
        'operation', lower(v_operation),
        'reason', NULLIF(TRIM(COALESCE(p_reason, '')), '')
      ),
      NULL,
      NULL,
      v_target_email
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
      actor_role,
      target_email
    ) VALUES (
      p_tenant_id,
      p_admin_user_id::TEXT,
      'session.revoked',
      'auth_session',
      p_target_user_id::TEXT,
      jsonb_build_object(
        'before_state_snapshot', jsonb_build_object('token_version', v_old_token_version),
        'after_state_snapshot', jsonb_build_object('token_version', v_new_token_version)
      ),
      jsonb_build_object(
        'timestamp', NOW(),
        'admin_user_id', p_admin_user_id::TEXT,
        'action_type', 'session_revocation',
        'affected_user_id', p_target_user_id::TEXT,
        'affected_department_id', NULL,
        'reason', 'permission_change'
      ),
      NULL,
      NULL,
      v_target_email
    );
  END IF;

  RETURN QUERY
  SELECT
    v_changed,
    lower(v_operation),
    v_role_key,
    p_target_user_id,
    v_target_email,
    v_before_snapshot,
    v_after_snapshot,
    v_old_token_version,
    v_new_token_version;
END;
$$;


ALTER FUNCTION "public"."admin_change_user_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_target_user_id" "uuid", "p_role_key" "text", "p_operation" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("team_id" "uuid", "department_name" "text", "is_active" boolean, "before_state_snapshot" "jsonb", "after_state_snapshot" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_team_id UUID;
  v_before JSONB := jsonb_build_object('department', NULL);
  v_after JSONB;
  v_admin_email TEXT;
  v_admin_role TEXT;
BEGIN
  IF p_tenant_id IS NULL OR p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Tenant and admin user are required';
  END IF;

  IF p_department_name IS NULL OR btrim(p_department_name) = '' THEN
    RAISE EXCEPTION 'Department name is required';
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

  INSERT INTO public.teams (tenant_id, name, is_active, deleted_at)
  VALUES (p_tenant_id, btrim(p_department_name), TRUE, NULL)
  RETURNING id INTO v_team_id;

  v_after := jsonb_build_object(
    'department', jsonb_build_object('id', v_team_id, 'name', btrim(p_department_name), 'is_active', TRUE)
  );

  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, changes, metadata, actor_email, actor_role
  ) VALUES (
    p_tenant_id,
    p_admin_user_id::TEXT,
    'team.created',
    'team',
    v_team_id::TEXT,
    jsonb_build_object('before_state_snapshot', v_before, 'after_state_snapshot', v_after),
    jsonb_build_object('reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'department_name', btrim(p_department_name)),
    v_admin_email,
    v_admin_role
  );

  RETURN QUERY
  SELECT v_team_id, btrim(p_department_name), TRUE, v_before, v_after;
END;
$$;


ALTER FUNCTION "public"."admin_create_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_department_with_emails"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_poc_email" "text", "p_hod_email" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("team_id" "uuid", "department_name" "text", "is_active" boolean, "poc_email" "text", "hod_email" "text", "before_state_snapshot" "jsonb", "after_state_snapshot" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_team_id UUID;
  v_admin_email TEXT;
  v_admin_role TEXT;
  v_admin_legacy_role TEXT;
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

  SELECT u.email, u.role
    INTO v_admin_email, v_admin_legacy_role
  FROM public.users u
  WHERE u.id = p_admin_user_id
    AND u.tenant_id = p_tenant_id
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL;

  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Admin user not found in tenant context';
  END IF;

  v_admin_role := public.resolve_user_effective_role(p_tenant_id, p_admin_user_id, v_admin_legacy_role);

  INSERT INTO public.teams (tenant_id, name, poc_email, hod_email, is_active, deleted_at)
  VALUES (p_tenant_id, btrim(p_department_name), v_normalized_poc_email, v_normalized_hod_email, TRUE, NULL)
  RETURNING teams.id INTO v_team_id;

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
  ON CONFLICT ON CONSTRAINT team_role_mappings_tenant_team_email_role_unique
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
$_$;


ALTER FUNCTION "public"."admin_create_department_with_emails"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_poc_email" "text", "p_hod_email" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("team_id" "uuid", "role_type" "text", "previous_email" "text", "next_email" "text", "before_state_snapshot" "jsonb", "after_state_snapshot" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_admin_email TEXT;
  v_admin_role TEXT;
  v_admin_legacy_role TEXT;
  v_role_type TEXT := UPPER(TRIM(COALESCE(p_role_type, '')));
  v_normalized_new_email TEXT := lower(trim(COALESCE(p_new_email, '')));
  v_previous_email TEXT;
  v_other_role TEXT;
  v_other_role_email TEXT;
  v_before JSONB;
  v_after JSONB;
  v_previous_user_id UUID;
  v_new_user_id UUID;
  v_affected_contracts BIGINT := 0;
  v_affected_pending_approvers BIGINT := 0;
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

  SELECT u.email, u.role
    INTO v_admin_email, v_admin_legacy_role
  FROM public.users u
  WHERE u.id = p_admin_user_id
    AND u.tenant_id = p_tenant_id
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL;

  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Admin user not found in tenant context';
  END IF;

  v_admin_role := public.resolve_user_effective_role(p_tenant_id, p_admin_user_id, v_admin_legacy_role);

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

  SELECT u.id
    INTO v_previous_user_id
  FROM public.users u
  WHERE u.tenant_id = p_tenant_id
    AND u.email = v_previous_email
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL
  LIMIT 1;

  SELECT u.id
    INTO v_new_user_id
  FROM public.users u
  WHERE u.tenant_id = p_tenant_id
    AND u.email = v_normalized_new_email
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL
  LIMIT 1;

  IF v_previous_user_id IS NOT NULL AND v_new_user_id IS NULL THEN
    RAISE EXCEPTION 'Replacement user account must exist and be active for ownership transfer';
  END IF;

  v_before := jsonb_build_object(
    'role_type', v_role_type,
    'old_email', v_previous_email,
    'new_email', v_normalized_new_email,
    'old_user_id', v_previous_user_id,
    'new_user_id', v_new_user_id
  );

  UPDATE public.team_role_mappings trm
  SET active_flag = FALSE,
      replaced_by = p_admin_user_id,
      replaced_at = NOW(),
      updated_at = NOW()
  WHERE trm.tenant_id = p_tenant_id
    AND trm.team_id = p_team_id
    AND trm.role_type = v_role_type
    AND trm.active_flag = TRUE
    AND trm.deleted_at IS NULL;

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
  ON CONFLICT ON CONSTRAINT team_role_mappings_tenant_team_email_role_unique
  DO UPDATE SET
    active_flag = TRUE,
    assigned_by = p_admin_user_id,
    assigned_at = NOW(),
    replaced_by = NULL,
    replaced_at = NULL,
    deleted_at = NULL,
    updated_at = NOW();

  UPDATE public.teams t
  SET poc_email = CASE WHEN v_role_type = 'POC' THEN v_normalized_new_email ELSE t.poc_email END,
      hod_email = CASE WHEN v_role_type = 'HOD' THEN v_normalized_new_email ELSE t.hod_email END,
      updated_at = NOW()
  WHERE t.id = p_team_id
    AND t.tenant_id = p_tenant_id;

  IF v_previous_user_id IS NOT NULL AND v_new_user_id IS NOT NULL THEN
    IF v_role_type = 'POC' THEN
      UPDATE public.contracts c
      SET uploaded_by_employee_id = v_new_user_id::TEXT,
          uploaded_by_email = v_normalized_new_email,
          updated_at = NOW()
      WHERE c.tenant_id = p_tenant_id
        AND c.deleted_at IS NULL
        AND c.uploaded_by_employee_id = v_previous_user_id::TEXT;

      GET DIAGNOSTICS v_affected_contracts = ROW_COUNT;
    ELSE
      UPDATE public.contracts c
      SET current_assignee_employee_id = v_new_user_id::TEXT,
          current_assignee_email = v_normalized_new_email,
          updated_at = NOW()
      WHERE c.tenant_id = p_tenant_id
        AND c.deleted_at IS NULL
        AND c.status = 'HOD_PENDING'
        AND c.current_assignee_employee_id = v_previous_user_id::TEXT;

      GET DIAGNOSTICS v_affected_contracts = ROW_COUNT;
    END IF;

    UPDATE public.contract_additional_approvers caa
    SET approver_employee_id = v_new_user_id::TEXT,
        approver_email = v_normalized_new_email,
        updated_at = NOW()
    WHERE caa.tenant_id = p_tenant_id
      AND caa.deleted_at IS NULL
      AND caa.status = 'PENDING'
      AND caa.approver_employee_id = v_previous_user_id::TEXT;

    GET DIAGNOSTICS v_affected_pending_approvers = ROW_COUNT;

    UPDATE public.users u
    SET token_version = COALESCE(u.token_version, 0) + 1,
        updated_at = NOW()
    WHERE u.id = v_previous_user_id
      AND u.tenant_id = p_tenant_id
      AND u.deleted_at IS NULL;
  END IF;

  v_after := jsonb_build_object(
    'role_type', v_role_type,
    'old_email', v_previous_email,
    'new_email', v_normalized_new_email,
    'old_user_id', v_previous_user_id,
    'new_user_id', v_new_user_id,
    'affected_contracts', v_affected_contracts,
    'affected_pending_approvers', v_affected_pending_approvers,
    'old_user_sessions_revoked', (v_previous_user_id IS NOT NULL AND v_new_user_id IS NOT NULL)
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
    actor_role,
    target_email
  ) VALUES (
    p_tenant_id,
    p_admin_user_id::TEXT,
    CASE WHEN v_role_type = 'POC' THEN 'team.poc.replaced' ELSE 'team.hod.replaced' END,
    'team_role_mappings',
    p_team_id::TEXT,
    jsonb_build_object('before_state_snapshot', v_before, 'after_state_snapshot', v_after),
    jsonb_build_object(
      'reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      'role_type', v_role_type,
      'affected_contracts', v_affected_contracts,
      'affected_pending_approvers', v_affected_pending_approvers,
      'revoked_user_id', v_previous_user_id
    ),
    v_admin_email,
    v_admin_role,
    v_normalized_new_email
  );

  RETURN QUERY
  SELECT p_team_id, v_role_type, v_previous_email, v_normalized_new_email, v_before, v_after;
END;
$_$;


ALTER FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_new_name" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("team_id" "uuid", "role_type" "text", "previous_email" "text", "next_email" "text", "before_state_snapshot" "jsonb", "after_state_snapshot" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_admin_email TEXT;
  v_admin_role TEXT;
  v_admin_legacy_role TEXT;
  v_role_type TEXT := UPPER(TRIM(COALESCE(p_role_type, '')));
  v_normalized_new_email TEXT := lower(trim(COALESCE(p_new_email, '')));
  v_normalized_new_name TEXT := NULLIF(TRIM(COALESCE(p_new_name, '')), '');
  v_previous_email TEXT;
  v_previous_name TEXT;
  v_other_role TEXT;
  v_other_role_email TEXT;
  v_before JSONB;
  v_after JSONB;
  v_previous_user_id UUID;
  v_new_user_id UUID;
  v_affected_contracts BIGINT := 0;
  v_affected_pending_approvers BIGINT := 0;
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

  IF v_normalized_new_name IS NULL OR char_length(v_normalized_new_name) < 2 THEN
    RAISE EXCEPTION 'New name is required';
  END IF;

  IF v_normalized_new_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  SELECT u.email, u.role
    INTO v_admin_email, v_admin_legacy_role
  FROM public.users u
  WHERE u.id = p_admin_user_id
    AND u.tenant_id = p_tenant_id
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL;

  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Admin user not found in tenant context';
  END IF;

  v_admin_role := public.resolve_user_effective_role(p_tenant_id, p_admin_user_id, v_admin_legacy_role);

  IF NOT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = p_team_id
      AND t.tenant_id = p_tenant_id
      AND t.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Department not found in tenant context';
  END IF;

  SELECT
    trm.email,
    CASE WHEN v_role_type = 'POC' THEN t.poc_name ELSE t.hod_name END
    INTO v_previous_email, v_previous_name
  FROM public.team_role_mappings trm
  JOIN public.teams t
    ON t.id = trm.team_id
   AND t.tenant_id = trm.tenant_id
  WHERE trm.tenant_id = p_tenant_id
    AND trm.team_id = p_team_id
    AND trm.role_type = v_role_type
    AND trm.active_flag = TRUE
    AND trm.deleted_at IS NULL
    AND t.deleted_at IS NULL
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

  SELECT u.id
    INTO v_previous_user_id
  FROM public.users u
  WHERE u.tenant_id = p_tenant_id
    AND u.email = v_previous_email
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL
  LIMIT 1;

  SELECT u.id
    INTO v_new_user_id
  FROM public.users u
  WHERE u.tenant_id = p_tenant_id
    AND u.email = v_normalized_new_email
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL
  LIMIT 1;

  IF v_previous_user_id IS NOT NULL AND v_new_user_id IS NULL THEN
    RAISE EXCEPTION 'Replacement user account must exist and be active for ownership transfer';
  END IF;

  v_before := jsonb_build_object(
    'role_type', v_role_type,
    'old_email', v_previous_email,
    'new_email', v_normalized_new_email,
    'old_name', v_previous_name,
    'new_name', v_normalized_new_name,
    'old_user_id', v_previous_user_id,
    'new_user_id', v_new_user_id
  );

  UPDATE public.team_role_mappings trm
  SET active_flag = FALSE,
      replaced_by = p_admin_user_id,
      replaced_at = NOW(),
      updated_at = NOW()
  WHERE trm.tenant_id = p_tenant_id
    AND trm.team_id = p_team_id
    AND trm.role_type = v_role_type
    AND trm.active_flag = TRUE
    AND trm.deleted_at IS NULL;

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
  ON CONFLICT ON CONSTRAINT team_role_mappings_tenant_team_email_role_unique
  DO UPDATE SET
    active_flag = TRUE,
    assigned_by = p_admin_user_id,
    assigned_at = NOW(),
    replaced_by = NULL,
    replaced_at = NULL,
    deleted_at = NULL,
    updated_at = NOW();

  UPDATE public.teams t
  SET poc_email = CASE WHEN v_role_type = 'POC' THEN v_normalized_new_email ELSE t.poc_email END,
      hod_email = CASE WHEN v_role_type = 'HOD' THEN v_normalized_new_email ELSE t.hod_email END,
      poc_name = CASE WHEN v_role_type = 'POC' THEN v_normalized_new_name ELSE t.poc_name END,
      hod_name = CASE WHEN v_role_type = 'HOD' THEN v_normalized_new_name ELSE t.hod_name END,
      updated_at = NOW()
  WHERE t.id = p_team_id
    AND t.tenant_id = p_tenant_id;

  IF v_new_user_id IS NOT NULL THEN
    UPDATE public.users u
    SET full_name = v_normalized_new_name,
        updated_at = NOW()
    WHERE u.id = v_new_user_id
      AND u.tenant_id = p_tenant_id
      AND u.deleted_at IS NULL
      AND (u.full_name IS DISTINCT FROM v_normalized_new_name);
  END IF;

  IF v_previous_user_id IS NOT NULL AND v_new_user_id IS NOT NULL THEN
    IF v_role_type = 'POC' THEN
      UPDATE public.contracts c
      SET uploaded_by_employee_id = v_new_user_id::TEXT,
          uploaded_by_email = v_normalized_new_email,
          updated_at = NOW()
      WHERE c.tenant_id = p_tenant_id
        AND c.deleted_at IS NULL
        AND c.uploaded_by_employee_id = v_previous_user_id::TEXT;

      GET DIAGNOSTICS v_affected_contracts = ROW_COUNT;
    ELSE
      UPDATE public.contracts c
      SET current_assignee_employee_id = v_new_user_id::TEXT,
          current_assignee_email = v_normalized_new_email,
          updated_at = NOW()
      WHERE c.tenant_id = p_tenant_id
        AND c.deleted_at IS NULL
        AND c.status = 'HOD_PENDING'
        AND c.current_assignee_employee_id = v_previous_user_id::TEXT;

      GET DIAGNOSTICS v_affected_contracts = ROW_COUNT;
    END IF;

    UPDATE public.contract_additional_approvers caa
    SET approver_employee_id = v_new_user_id::TEXT,
        approver_email = v_normalized_new_email,
        updated_at = NOW()
    WHERE caa.tenant_id = p_tenant_id
      AND caa.deleted_at IS NULL
      AND caa.status = 'PENDING'
      AND caa.approver_employee_id = v_previous_user_id::TEXT;

    GET DIAGNOSTICS v_affected_pending_approvers = ROW_COUNT;

    UPDATE public.users u
    SET token_version = COALESCE(u.token_version, 0) + 1,
        updated_at = NOW()
    WHERE u.id = v_previous_user_id
      AND u.tenant_id = p_tenant_id
      AND u.deleted_at IS NULL;
  END IF;

  v_after := jsonb_build_object(
    'role_type', v_role_type,
    'old_email', v_previous_email,
    'new_email', v_normalized_new_email,
    'old_name', v_previous_name,
    'new_name', v_normalized_new_name,
    'old_user_id', v_previous_user_id,
    'new_user_id', v_new_user_id,
    'affected_contracts', v_affected_contracts,
    'affected_pending_approvers', v_affected_pending_approvers,
    'old_user_sessions_revoked', (v_previous_user_id IS NOT NULL AND v_new_user_id IS NOT NULL)
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
    actor_role,
    target_email
  ) VALUES (
    p_tenant_id,
    p_admin_user_id::TEXT,
    CASE WHEN v_role_type = 'POC' THEN 'team.poc.replaced' ELSE 'team.hod.replaced' END,
    'team_role_mappings',
    p_team_id::TEXT,
    jsonb_build_object('before_state_snapshot', v_before, 'after_state_snapshot', v_after),
    jsonb_build_object(
      'reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      'role_type', v_role_type,
      'affected_contracts', v_affected_contracts,
      'affected_pending_approvers', v_affected_pending_approvers,
      'revoked_user_id', v_previous_user_id
    ),
    v_admin_email,
    v_admin_role,
    v_normalized_new_email
  );

  RETURN QUERY
  SELECT p_team_id, v_role_type, v_previous_email, v_normalized_new_email, v_before, v_after;
END;
$_$;


ALTER FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_new_name" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_department_legal_matrix"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_legal_user_ids" "uuid"[], "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("team_id" "uuid", "active_legal_user_ids" "uuid"[], "before_state_snapshot" "jsonb", "after_state_snapshot" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_email TEXT;
  v_admin_role TEXT;
  v_admin_legacy_role TEXT;
  v_requested UUID[] := COALESCE(p_legal_user_ids, ARRAY[]::UUID[]);
  v_removed_user_ids UUID[] := ARRAY[]::UUID[];
  v_removed_user_id UUID;
  v_user_current_role TEXT;
  v_user_next_role TEXT;
  v_before_users JSONB := '[]'::JSONB;
  v_after_users JSONB := '[]'::JSONB;
  v_before JSONB;
  v_after JSONB;
  v_valid_count INTEGER := 0;
  v_requested_count INTEGER := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_admin_user_id IS NULL OR p_team_id IS NULL THEN
    RAISE EXCEPTION 'Tenant, admin user, and team are required';
  END IF;

  SELECT u.email, u.role
    INTO v_admin_email, v_admin_legacy_role
  FROM public.users u
  WHERE u.id = p_admin_user_id
    AND u.tenant_id = p_tenant_id
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL;

  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Admin user not found in tenant context';
  END IF;

  v_admin_role := public.resolve_user_effective_role(p_tenant_id, p_admin_user_id, v_admin_legacy_role);

  IF NOT EXISTS (
    SELECT 1
    FROM public.teams
    WHERE id = p_team_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Department not found in tenant context';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_requested_count
  FROM unnest(v_requested);

  IF v_requested_count > 0 THEN
    SELECT COUNT(*)::INTEGER
      INTO v_valid_count
    FROM public.users u
    WHERE u.tenant_id = p_tenant_id
      AND u.id = ANY(v_requested)
      AND u.is_active = TRUE
      AND u.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.user_roles ur
          JOIN public.roles r
            ON r.id = ur.role_id
           AND r.tenant_id = ur.tenant_id
          WHERE ur.tenant_id = u.tenant_id
            AND ur.user_id = u.id
            AND ur.is_active = TRUE
            AND ur.deleted_at IS NULL
            AND r.is_active = TRUE
            AND r.deleted_at IS NULL
            AND UPPER(r.role_key) IN ('LEGAL_TEAM', 'LEGAL_ADMIN', 'SUPER_ADMIN')
        )
        OR UPPER(COALESCE(u.role, '')) IN ('LEGAL_TEAM', 'LEGAL_ADMIN', 'SUPER_ADMIN')
      );

    IF v_valid_count != v_requested_count THEN
      RAISE EXCEPTION 'All legal matrix users must be active legal-scope users in tenant context';
    END IF;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('user_id', a.user_id, 'email', u.email)
      ORDER BY u.email
    ),
    '[]'::JSONB
  ) INTO v_before_users
  FROM public.department_legal_assignments a
  JOIN public.users u
    ON u.id = a.user_id
   AND u.tenant_id = a.tenant_id
  WHERE a.tenant_id = p_tenant_id
    AND a.department_id = p_team_id
    AND a.is_active = TRUE
    AND a.deleted_at IS NULL;

  v_before := jsonb_build_object('team_id', p_team_id, 'legal_assignments', v_before_users);

  SELECT COALESCE(array_agg(a.user_id ORDER BY a.user_id), ARRAY[]::UUID[])
    INTO v_removed_user_ids
  FROM public.department_legal_assignments a
  WHERE a.tenant_id = p_tenant_id
    AND a.department_id = p_team_id
    AND a.is_active = TRUE
    AND a.deleted_at IS NULL
    AND NOT (a.user_id = ANY(v_requested));

  UPDATE public.department_legal_assignments a
  SET is_active = FALSE,
      revoked_by = p_admin_user_id,
      revoked_at = NOW(),
      deleted_at = NOW(),
      updated_at = NOW()
  WHERE a.tenant_id = p_tenant_id
    AND a.department_id = p_team_id
    AND a.is_active = TRUE
    AND a.deleted_at IS NULL
    AND NOT (a.user_id = ANY(v_requested));

  IF v_requested_count > 0 THEN
    INSERT INTO public.department_legal_assignments (
      tenant_id,
      department_id,
      user_id,
      is_active,
      assigned_by,
      assigned_at,
      revoked_by,
      revoked_at,
      deleted_at
    )
    SELECT
      p_tenant_id,
      p_team_id,
      req.user_id,
      TRUE,
      p_admin_user_id,
      NOW(),
      NULL,
      NULL,
      NULL
    FROM unnest(v_requested) AS req(user_id)
    ON CONFLICT (tenant_id, department_id, user_id)
    DO UPDATE
      SET is_active = TRUE,
          assigned_by = EXCLUDED.assigned_by,
          assigned_at = NOW(),
          revoked_by = NULL,
          revoked_at = NULL,
          deleted_at = NULL,
          updated_at = NOW();
  END IF;

  FOREACH v_removed_user_id IN ARRAY v_removed_user_ids LOOP
    IF EXISTS (
      SELECT 1
      FROM public.department_legal_assignments a
      WHERE a.tenant_id = p_tenant_id
        AND a.user_id = v_removed_user_id
        AND a.is_active = TRUE
        AND a.deleted_at IS NULL
    ) THEN
      CONTINUE;
    END IF;

    UPDATE public.user_roles ur
    SET is_active = FALSE,
        revoked_by = p_admin_user_id,
        revoked_at = NOW(),
        deleted_at = NOW()
    FROM public.roles r
    WHERE ur.tenant_id = p_tenant_id
      AND ur.user_id = v_removed_user_id
      AND ur.role_id = r.id
      AND r.tenant_id = ur.tenant_id
      AND ur.is_active = TRUE
      AND ur.deleted_at IS NULL
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL
      AND UPPER(r.role_key) = 'LEGAL_TEAM';

    SELECT u.role
      INTO v_user_current_role
    FROM public.users u
    WHERE u.tenant_id = p_tenant_id
      AND u.id = v_removed_user_id
      AND u.is_active = TRUE
      AND u.deleted_at IS NULL;

    IF v_user_current_role IS NULL THEN
      CONTINUE;
    END IF;

    v_user_next_role := public.resolve_user_effective_role(p_tenant_id, v_removed_user_id, v_user_current_role);

    IF UPPER(COALESCE(v_user_next_role, '')) = 'LEGAL_TEAM' THEN
      v_user_next_role := 'USER';
    END IF;

    UPDATE public.users u
    SET role = COALESCE(NULLIF(TRIM(v_user_next_role), ''), 'USER'),
        token_version = COALESCE(u.token_version, 0) + 1,
        updated_at = NOW()
    WHERE u.id = v_removed_user_id
      AND u.tenant_id = p_tenant_id
      AND u.deleted_at IS NULL;
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('user_id', a.user_id, 'email', u.email)
      ORDER BY u.email
    ),
    '[]'::JSONB
  ) INTO v_after_users
  FROM public.department_legal_assignments a
  JOIN public.users u
    ON u.id = a.user_id
   AND u.tenant_id = a.tenant_id
  WHERE a.tenant_id = p_tenant_id
    AND a.department_id = p_team_id
    AND a.is_active = TRUE
    AND a.deleted_at IS NULL;

  v_after := jsonb_build_object('team_id', p_team_id, 'legal_assignments', v_after_users);

  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, changes, metadata, actor_email, actor_role
  ) VALUES (
    p_tenant_id,
    p_admin_user_id::TEXT,
    'team.legal.matrix.updated',
    'department_legal_assignments',
    p_team_id::TEXT,
    jsonb_build_object('before_state_snapshot', v_before, 'after_state_snapshot', v_after),
    jsonb_build_object(
      'reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      'revoked_user_ids', to_jsonb(v_removed_user_ids)
    ),
    v_admin_email,
    v_admin_role
  );

  RETURN QUERY
  SELECT
    p_team_id,
    ARRAY(
      SELECT a.user_id
      FROM public.department_legal_assignments a
      WHERE a.tenant_id = p_tenant_id
        AND a.department_id = p_team_id
        AND a.is_active = TRUE
        AND a.deleted_at IS NULL
      ORDER BY a.user_id
    )::UUID[],
    v_before,
    v_after;
END;
$$;


ALTER FUNCTION "public"."admin_set_department_legal_matrix"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_legal_user_ids" "uuid"[], "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_operation" "text", "p_department_name" "text" DEFAULT NULL::"text", "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("team_id" "uuid", "department_name" "text", "is_active" boolean, "before_state_snapshot" "jsonb", "after_state_snapshot" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_email TEXT;
  v_admin_role TEXT;
  v_before_name TEXT;
  v_before_active BOOLEAN;
  v_after_name TEXT;
  v_after_active BOOLEAN;
  v_operation TEXT := UPPER(TRIM(COALESCE(p_operation, '')));
  v_before JSONB;
  v_after JSONB;
BEGIN
  IF p_tenant_id IS NULL OR p_admin_user_id IS NULL OR p_team_id IS NULL THEN
    RAISE EXCEPTION 'Tenant, admin user, and department are required';
  END IF;

  IF v_operation NOT IN ('RENAME', 'DEACTIVATE') THEN
    RAISE EXCEPTION 'Operation must be RENAME or DEACTIVATE';
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

  SELECT name, is_active
    INTO v_before_name, v_before_active
  FROM public.teams
  WHERE id = p_team_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL;

  IF v_before_name IS NULL THEN
    RAISE EXCEPTION 'Department not found in tenant context';
  END IF;

  v_before := jsonb_build_object(
    'department', jsonb_build_object('id', p_team_id, 'name', v_before_name, 'is_active', v_before_active)
  );

  IF v_operation = 'RENAME' THEN
    IF p_department_name IS NULL OR btrim(p_department_name) = '' THEN
      RAISE EXCEPTION 'Department name is required for rename';
    END IF;

    UPDATE public.teams
    SET name = btrim(p_department_name),
        updated_at = NOW()
    WHERE id = p_team_id
      AND tenant_id = p_tenant_id;

    v_after_name := btrim(p_department_name);
    v_after_active := v_before_active;
  ELSE
    UPDATE public.teams
    SET is_active = FALSE,
        deleted_at = COALESCE(deleted_at, NOW()),
        updated_at = NOW()
    WHERE id = p_team_id
      AND tenant_id = p_tenant_id;

    v_after_name := v_before_name;
    v_after_active := FALSE;

    UPDATE public.department_legal_assignments
    SET is_active = FALSE,
        revoked_by = p_admin_user_id,
        revoked_at = NOW(),
        deleted_at = COALESCE(deleted_at, NOW()),
        updated_at = NOW()
    WHERE tenant_id = p_tenant_id
      AND department_id = p_team_id
      AND is_active = TRUE
      AND deleted_at IS NULL;
  END IF;

  v_after := jsonb_build_object(
    'department', jsonb_build_object('id', p_team_id, 'name', v_after_name, 'is_active', v_after_active)
  );

  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, changes, metadata, actor_email, actor_role
  ) VALUES (
    p_tenant_id,
    p_admin_user_id::TEXT,
    CASE WHEN v_operation = 'RENAME' THEN 'team.renamed' ELSE 'team.deactivated' END,
    'team',
    p_team_id::TEXT,
    jsonb_build_object('before_state_snapshot', v_before, 'after_state_snapshot', v_after),
    jsonb_build_object('reason', NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'operation', lower(v_operation)),
    v_admin_email,
    v_admin_role
  );

  RETURN QUERY
  SELECT p_team_id, v_after_name, v_after_active, v_before, v_after;
END;
$$;


ALTER FUNCTION "public"."admin_update_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_operation" "text", "p_department_name" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."business_day_add"("start_date" "date", "days" integer) RETURNS "date"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  direction INTEGER := CASE WHEN days >= 0 THEN 1 ELSE -1 END;
  remaining INTEGER := ABS(days);
  cursor_date DATE := start_date;
BEGIN
  IF days = 0 THEN
    RETURN start_date;
  END IF;

  WHILE remaining > 0 LOOP
    cursor_date := cursor_date + direction;

    IF EXTRACT(ISODOW FROM cursor_date) < 6
       AND NOT EXISTS (
         SELECT 1
         FROM public.holidays h
         WHERE h.holiday_date = cursor_date
       ) THEN
      remaining := remaining - 1;
    END IF;
  END LOOP;

  RETURN cursor_date;
END;
$$;


ALTER FUNCTION "public"."business_day_add"("start_date" "date", "days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."business_day_diff"("start_date" "date", "end_date" "date") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH bounds AS (
    SELECT LEAST(start_date, end_date) AS lo,
           GREATEST(start_date, end_date) AS hi,
           CASE WHEN end_date >= start_date THEN 1 ELSE -1 END AS direction
  ),
  days AS (
    SELECT gs::date AS day
    FROM bounds,
    generate_series(bounds.lo + 1, bounds.hi, interval '1 day') AS gs
  ),
  business_days AS (
    SELECT COUNT(*)::INTEGER AS count_days
    FROM days d
    WHERE EXTRACT(ISODOW FROM d.day) < 6
      AND NOT EXISTS (
        SELECT 1
        FROM public.holidays h
        WHERE h.holiday_date = d.day
      )
  )
  SELECT COALESCE((SELECT b.direction * bd.count_days FROM bounds b CROSS JOIN business_days bd), 0);
$$;


ALTER FUNCTION "public"."business_day_diff"("start_date" "date", "end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_contract_primary_document_version"("p_tenant_id" "uuid", "p_contract_id" "uuid", "p_display_name" "text", "p_file_name" "text", "p_file_path" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text") RETURNS TABLE("document_id" "uuid", "version_number" numeric, "replaced_document_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_contract contracts%ROWTYPE;
  v_latest_document contract_documents%ROWTYPE;
  v_next_version NUMERIC(10,1);
  v_new_document_id UUID;
BEGIN
  SELECT *
  INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contract not found for tenant';
  END IF;

  IF v_contract.status = 'IN_SIGNATURE' THEN
    RAISE EXCEPTION 'CONTRACT_IN_SIGNATURE_REPLACEMENT_FORBIDDEN';
  END IF;

  SELECT *
  INTO v_latest_document
  FROM public.contract_documents
  WHERE tenant_id = p_tenant_id
    AND contract_id = p_contract_id
    AND document_kind = 'PRIMARY'
    AND deleted_at IS NULL
  ORDER BY version_number DESC, created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  v_next_version := COALESCE(v_latest_document.version_number, 0) + 1.0;

  INSERT INTO public.contract_documents (
    tenant_id,
    contract_id,
    document_kind,
    display_name,
    file_name,
    file_path,
    file_size_bytes,
    file_mime_type,
    uploaded_by_employee_id,
    uploaded_by_email,
    uploaded_role,
    version_number,
    replaced_document_id
  )
  VALUES (
    p_tenant_id,
    p_contract_id,
    'PRIMARY',
    p_display_name,
    p_file_name,
    p_file_path,
    p_file_size_bytes,
    p_file_mime_type,
    p_uploaded_by_employee_id,
    p_uploaded_by_email,
    p_uploaded_by_role,
    v_next_version,
    v_latest_document.id
  )
  RETURNING id
  INTO v_new_document_id;

  UPDATE public.contracts
  SET current_document_id = v_new_document_id,
      file_path = p_file_path,
      file_name = p_file_name,
      file_size_bytes = p_file_size_bytes,
      file_mime_type = p_file_mime_type,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND id = p_contract_id
    AND deleted_at IS NULL;

  RETURN QUERY
  SELECT v_new_document_id, v_next_version, v_latest_document.id;
END;
$$;


ALTER FUNCTION "public"."create_contract_primary_document_version"("p_tenant_id" "uuid", "p_contract_id" "uuid", "p_display_name" "text", "p_file_name" "text", "p_file_path" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_contract_with_audit"("p_contract_id" "uuid", "p_tenant_id" "uuid", "p_title" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text", "p_file_path" "text", "p_file_name" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_signatory_name" "text", "p_signatory_designation" "text", "p_signatory_email" "text", "p_background_of_request" "text", "p_department_id" "uuid", "p_contract_type_id" "uuid", "p_budget_approved" boolean, "p_upload_mode" "text" DEFAULT 'DEFAULT'::"text", "p_bypass_hod_approval" boolean DEFAULT false, "p_bypass_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("contract_id" "uuid", "status" "text", "current_assignee_employee_id" "text", "current_assignee_email" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  uploader RECORD;
  assignee_id UUID;
  assignee_email TEXT;
  initial_status TEXT;
  uploader_team_role TEXT;
  resolved_user_role TEXT;
  effective_uploader_role TEXT;
  normalized_upload_mode TEXT := UPPER(COALESCE(p_upload_mode, 'DEFAULT'));
  bypass_hod_approval BOOLEAN := COALESCE(p_bypass_hod_approval, FALSE);
  normalized_bypass_reason TEXT := NULLIF(BTRIM(COALESCE(p_bypass_reason, '')), '');
  routing_team_id UUID;
BEGIN
  IF p_uploaded_by_employee_id IS NULL OR btrim(p_uploaded_by_employee_id) = '' THEN
    RAISE EXCEPTION 'Actor employee id is required for contract upload';
  END IF;

  IF p_uploaded_by_email IS NULL OR btrim(p_uploaded_by_email) = '' THEN
    RAISE EXCEPTION 'Actor email is required for contract upload';
  END IF;

  IF p_uploaded_by_role IS NULL OR btrim(p_uploaded_by_role) = '' THEN
    RAISE EXCEPTION 'Actor role is required for contract upload';
  END IF;

  IF p_signatory_name IS NULL OR btrim(p_signatory_name) = '' THEN
    RAISE EXCEPTION 'Signatory name is required';
  END IF;

  IF p_signatory_designation IS NULL OR btrim(p_signatory_designation) = '' THEN
    RAISE EXCEPTION 'Signatory designation is required';
  END IF;

  IF p_signatory_email IS NULL
     OR btrim(p_signatory_email) = ''
     OR (
       p_signatory_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
       AND upper(btrim(p_signatory_email)) <> 'NA'
     ) THEN
    RAISE EXCEPTION 'Valid signatory email is required';
  END IF;

  IF p_background_of_request IS NULL OR btrim(p_background_of_request) = '' THEN
    RAISE EXCEPTION 'Background of request is required';
  END IF;

  IF normalized_upload_mode NOT IN ('DEFAULT', 'LEGAL_SEND_FOR_SIGNING') THEN
    RAISE EXCEPTION 'Unsupported upload mode';
  END IF;

  SELECT u.id, u.email, u.role
  INTO uploader
  FROM public.users u
  WHERE u.id = p_uploaded_by_employee_id::UUID
    AND u.tenant_id = p_tenant_id
    AND lower(u.email) = lower(p_uploaded_by_email)
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL
  LIMIT 1;

  IF uploader IS NULL THEN
    RAISE EXCEPTION 'Uploader is not valid for tenant context';
  END IF;

  SELECT trm.role_type
  INTO uploader_team_role
  FROM public.team_role_mappings trm
  WHERE trm.tenant_id = p_tenant_id
    AND lower(trm.email) = lower(p_uploaded_by_email)
    AND trm.active_flag = TRUE
    AND trm.deleted_at IS NULL
    AND trm.role_type IN ('POC', 'HOD')
  ORDER BY (trm.team_id = p_department_id) DESC, trm.assigned_at DESC
  LIMIT 1;

  resolved_user_role := UPPER(public.resolve_user_effective_role(p_tenant_id, uploader.id::UUID, uploader.role));

  -- Team mapping should only decide role when the request itself is from POC/HOD.
  -- For LEGAL_TEAM/ADMIN/USER sessions we honor resolved account role.
  IF upper(p_uploaded_by_role) IN ('POC', 'HOD') THEN
    effective_uploader_role := UPPER(COALESCE(uploader_team_role, resolved_user_role));
  ELSE
    effective_uploader_role := resolved_user_role;
  END IF;

  IF effective_uploader_role NOT IN ('POC', 'HOD', 'LEGAL_TEAM', 'ADMIN', 'USER') THEN
    RAISE EXCEPTION 'Uploader role is not allowed to create contracts';
  END IF;

  IF upper(effective_uploader_role) <> upper(p_uploaded_by_role) THEN
    RAISE EXCEPTION 'Uploader role does not match session role';
  END IF;

  IF normalized_upload_mode = 'LEGAL_SEND_FOR_SIGNING' AND effective_uploader_role <> 'LEGAL_TEAM' THEN
    RAISE EXCEPTION 'Only LEGAL_TEAM can use send-for-signing upload mode';
  END IF;

  IF bypass_hod_approval AND normalized_upload_mode <> 'LEGAL_SEND_FOR_SIGNING' THEN
    RAISE EXCEPTION 'Bypass is only available in send-for-signing mode';
  END IF;

  IF bypass_hod_approval AND normalized_bypass_reason IS NULL THEN
    RAISE EXCEPTION 'Bypass reason is required when bypassing HOD approval';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = p_department_id
      AND t.tenant_id = p_tenant_id
      AND t.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Department does not exist in tenant context';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contract_types ct
    WHERE ct.id = p_contract_type_id
      AND ct.tenant_id = p_tenant_id
      AND ct.deleted_at IS NULL
      AND ct.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Contract type does not exist in tenant context';
  END IF;

  IF normalized_upload_mode = 'LEGAL_SEND_FOR_SIGNING' AND bypass_hod_approval THEN
    assignee_id := uploader.id;
    assignee_email := lower(btrim(uploader.email));
    initial_status := 'COMPLETED';
  ELSE
    IF normalized_upload_mode = 'LEGAL_SEND_FOR_SIGNING' THEN
      SELECT t.id
      INTO routing_team_id
      FROM public.teams t
      WHERE t.tenant_id = p_tenant_id
        AND lower(t.name) = lower('Legal and Compliance')
        AND t.deleted_at IS NULL
      ORDER BY t.created_at DESC
      LIMIT 1;

      IF routing_team_id IS NULL THEN
        RAISE EXCEPTION 'Legal and Compliance department is not configured';
      END IF;
    ELSE
      routing_team_id := p_department_id;
    END IF;

    SELECT u.id, u.email
    INTO assignee_id, assignee_email
    FROM public.team_role_mappings trm
    JOIN public.users u
      ON u.tenant_id = trm.tenant_id
     AND lower(u.email) = lower(trm.email)
     AND u.is_active = TRUE
     AND u.deleted_at IS NULL
    WHERE trm.tenant_id = p_tenant_id
      AND trm.team_id = routing_team_id
      AND trm.role_type = 'HOD'
      AND trm.active_flag = TRUE
      AND trm.deleted_at IS NULL
    ORDER BY trm.assigned_at DESC
    LIMIT 1;

    IF assignee_id IS NULL OR assignee_email IS NULL THEN
      RAISE EXCEPTION 'No active HOD configured for routing department';
    END IF;

    initial_status := 'HOD_PENDING';
  END IF;

  INSERT INTO public.contracts (
    id,
    tenant_id,
    title,
    uploaded_by_employee_id,
    uploaded_by_email,
    current_assignee_employee_id,
    current_assignee_email,
    status,
    file_path,
    file_name,
    file_size_bytes,
    file_mime_type,
    signatory_name,
    signatory_designation,
    signatory_email,
    background_of_request,
    department_id,
    contract_type_id,
    budget_approved,
    request_created_at
  ) VALUES (
    p_contract_id,
    p_tenant_id,
    btrim(p_title),
    p_uploaded_by_employee_id,
    lower(btrim(p_uploaded_by_email)),
    assignee_id::TEXT,
    lower(btrim(assignee_email)),
    initial_status,
    p_file_path,
    p_file_name,
    p_file_size_bytes,
    p_file_mime_type,
    btrim(p_signatory_name),
    btrim(p_signatory_designation),
    lower(btrim(p_signatory_email)),
    btrim(p_background_of_request),
    p_department_id,
    p_contract_type_id,
    COALESCE(p_budget_approved, FALSE),
    NOW()
  );

  IF normalized_upload_mode = 'LEGAL_SEND_FOR_SIGNING' AND NOT bypass_hod_approval THEN
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      event_type,
      action,
      actor_email,
      actor_role,
      resource_type,
      resource_id,
      metadata,
      target_email,
      note_text
    ) VALUES (
      p_tenant_id,
      p_uploaded_by_employee_id,
      'CONTRACT_SIGNATORY_SENT'::public.audit_event_type,
      'contract.legal.send_for_signing.initiated',
      lower(btrim(p_uploaded_by_email)),
      upper(effective_uploader_role),
      'contract',
      p_contract_id::TEXT,
      jsonb_build_object(
        'title', btrim(p_title),
        'status', initial_status,
        'file_path', p_file_path,
        'file_name', p_file_name,
        'file_size_bytes', p_file_size_bytes,
        'file_mime_type', p_file_mime_type,
        'signatory_name', btrim(p_signatory_name),
        'signatory_designation', btrim(p_signatory_designation),
        'signatory_email', lower(btrim(p_signatory_email)),
        'department_id', p_department_id,
        'routing_team_id', routing_team_id,
        'contract_type_id', p_contract_type_id,
        'budget_approved', COALESCE(p_budget_approved, FALSE),
        'upload_mode', normalized_upload_mode,
        'bypass_hod_approval', bypass_hod_approval,
        'workflow_label', 'Pending Legal HOD review'
      ),
      assignee_email,
      'Initiated Send for Signing workflow. Pending Legal HOD review.'
    );
  ELSE
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      event_type,
      action,
      actor_email,
      actor_role,
      resource_type,
      resource_id,
      metadata,
      target_email
    )
    VALUES
    (
      p_tenant_id,
      p_uploaded_by_employee_id,
      'CONTRACT_CREATED'::public.audit_event_type,
      'contract.created',
      lower(btrim(p_uploaded_by_email)),
      upper(effective_uploader_role),
      'contract',
      p_contract_id::TEXT,
      jsonb_build_object(
        'title', btrim(p_title),
        'status', initial_status,
        'file_path', p_file_path,
        'file_name', p_file_name,
        'file_size_bytes', p_file_size_bytes,
        'file_mime_type', p_file_mime_type,
        'signatory_name', btrim(p_signatory_name),
        'signatory_designation', btrim(p_signatory_designation),
        'signatory_email', lower(btrim(p_signatory_email)),
        'department_id', p_department_id,
        'routing_team_id', routing_team_id,
        'contract_type_id', p_contract_type_id,
        'budget_approved', COALESCE(p_budget_approved, FALSE),
        'upload_mode', normalized_upload_mode,
        'bypass_hod_approval', bypass_hod_approval
      ),
      assignee_email
    ),
    (
      p_tenant_id,
      p_uploaded_by_employee_id,
      'CONTRACT_TRANSITIONED'::public.audit_event_type,
      'contract.updated',
      lower(btrim(p_uploaded_by_email)),
      upper(effective_uploader_role),
      'contract',
      p_contract_id::TEXT,
      jsonb_build_object(
        'transition', 'system.initial_route',
        'to_status', initial_status
      ),
      assignee_email
    );
  END IF;

  IF bypass_hod_approval THEN
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      event_type,
      action,
      actor_email,
      actor_role,
      resource_type,
      resource_id,
      target_email,
      note_text,
      metadata
    ) VALUES (
      p_tenant_id,
      p_uploaded_by_employee_id,
      'CONTRACT_BYPASSED'::public.audit_event_type,
      'contract.hod.bypass',
      lower(btrim(p_uploaded_by_email)),
      upper(effective_uploader_role),
      'contract',
      p_contract_id::TEXT,
      assignee_email,
      normalized_bypass_reason,
      jsonb_build_object(
        'from_status', 'HOD_PENDING',
        'to_status', 'COMPLETED',
        'transition', 'system.legal_send_for_signing_bypass'
      )
    );
  END IF;

  RETURN QUERY
  SELECT p_contract_id, initial_status, assignee_id::TEXT, assignee_email;
END;
$_$;


ALTER FUNCTION "public"."create_contract_with_audit"("p_contract_id" "uuid", "p_tenant_id" "uuid", "p_title" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text", "p_file_path" "text", "p_file_name" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_signatory_name" "text", "p_signatory_designation" "text", "p_signatory_email" "text", "p_background_of_request" "text", "p_department_id" "uuid", "p_contract_type_id" "uuid", "p_budget_approved" boolean, "p_upload_mode" "text", "p_bypass_hod_approval" boolean, "p_bypass_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_contract_department_tenant_match"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  department_tenant_id UUID;
BEGIN
  SELECT tenant_id
  INTO department_tenant_id
  FROM public.teams
  WHERE id = NEW.department_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF department_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Department does not exist';
  END IF;

  IF department_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Department must belong to same tenant as contract';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_contract_department_tenant_match"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_contract_tat_mutability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.tat_breached_at IS DISTINCT FROM OLD.tat_breached_at THEN
    RAISE EXCEPTION 'tat_breached_at is system-controlled and cannot be manually modified';
  END IF;

  IF NEW.tat_deadline_at IS DISTINCT FROM OLD.tat_deadline_at THEN
    IF NOT (
      OLD.tat_deadline_at IS NULL
      AND OLD.status = 'HOD_PENDING'
      AND NEW.status IN ('UNDER_REVIEW', 'LEGAL_PENDING')
      AND NEW.tat_deadline_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'tat_deadline_at can only be set during HOD approval transition';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_contract_tat_mutability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_audit_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP != 'INSERT' THEN
    RAISE EXCEPTION 'Audit logs are immutable - no updates or deletes allowed';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_audit_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_primary_team_member"("p_tenant_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_actor_user_id" "text", "p_actor_email" "text", "p_actor_role" "text") RETURNS TABLE("id" "uuid", "tenant_id" "uuid", "team_id" "uuid", "user_id" "uuid", "role_type" "text", "is_primary" boolean, "user_email" "text", "user_full_name" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_existing_member_id UUID;
  v_old_primary_user_id UUID;
  v_old_primary_email TEXT;
  v_new_primary_email TEXT;
  v_new_primary_full_name TEXT;
  v_affected_contracts BIGINT := 0;
BEGIN
  IF p_role_type NOT IN ('POC', 'HOD') THEN
    RAISE EXCEPTION 'Role type must be POC or HOD';
  END IF;

  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'Actor user id is required';
  END IF;

  IF p_actor_email IS NULL OR btrim(p_actor_email) = '' THEN
    RAISE EXCEPTION 'Actor email is required';
  END IF;

  SELECT tm.user_id, u.email
    INTO v_old_primary_user_id, v_old_primary_email
  FROM public.team_members tm
  JOIN public.users u
    ON u.id = tm.user_id
   AND u.tenant_id = tm.tenant_id
  WHERE tm.tenant_id = p_tenant_id
    AND tm.team_id = p_team_id
    AND tm.role_type = p_role_type
    AND tm.is_primary = TRUE
  LIMIT 1;

  IF v_old_primary_user_id IS NULL THEN
    RAISE EXCEPTION 'No existing primary member found for role %', p_role_type;
  END IF;

  SELECT u.email, u.full_name
    INTO v_new_primary_email, v_new_primary_full_name
  FROM public.users u
  WHERE u.id = p_new_user_id
    AND u.tenant_id = p_tenant_id
    AND u.is_active = TRUE
    AND u.deleted_at IS NULL
  LIMIT 1;

  IF v_new_primary_email IS NULL THEN
    RAISE EXCEPTION 'New primary user is invalid for tenant context';
  END IF;

  UPDATE public.team_members tm
  SET is_primary = FALSE,
      updated_at = NOW()
  WHERE tm.tenant_id = p_tenant_id
    AND tm.team_id = p_team_id
    AND tm.role_type = p_role_type
    AND tm.is_primary = TRUE;

  SELECT tm.id INTO v_existing_member_id
  FROM public.team_members tm
  WHERE tm.tenant_id = p_tenant_id
    AND tm.team_id = p_team_id
    AND tm.user_id = p_new_user_id
  LIMIT 1;

  IF v_existing_member_id IS NOT NULL THEN
    UPDATE public.team_members tm
    SET is_primary = TRUE,
        role_type = p_role_type,
        updated_at = NOW()
    WHERE tm.id = v_existing_member_id;
  ELSE
    INSERT INTO public.team_members (
      tenant_id,
      team_id,
      user_id,
      role_type,
      is_primary
    ) VALUES (
      p_tenant_id,
      p_team_id,
      p_new_user_id,
      p_role_type,
      TRUE
    )
    RETURNING team_members.id INTO v_existing_member_id;
  END IF;

  IF p_role_type = 'POC' THEN
    UPDATE public.contracts c
    SET uploaded_by_employee_id = p_new_user_id::TEXT,
        uploaded_by_email = v_new_primary_email,
        updated_at = NOW()
    WHERE c.tenant_id = p_tenant_id
      AND c.deleted_at IS NULL
      AND c.uploaded_by_employee_id = v_old_primary_user_id::TEXT;

    GET DIAGNOSTICS v_affected_contracts = ROW_COUNT;
  ELSIF p_role_type = 'HOD' THEN
    UPDATE public.contracts c
    SET current_assignee_employee_id = p_new_user_id::TEXT,
        current_assignee_email = v_new_primary_email,
        updated_at = NOW()
    WHERE c.tenant_id = p_tenant_id
      AND c.deleted_at IS NULL
      AND c.status = 'HOD_PENDING'
      AND c.current_assignee_employee_id = v_old_primary_user_id::TEXT;

    GET DIAGNOSTICS v_affected_contracts = ROW_COUNT;
  END IF;

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    event_type,
    action,
    actor_email,
    actor_role,
    resource_type,
    resource_id,
    metadata,
    target_email
  ) VALUES (
    p_tenant_id,
    p_actor_user_id,
    'TEAM_MEMBER_REASSIGNED'::public.audit_event_type,
    'team.member.reassigned',
    p_actor_email,
    p_actor_role,
    'team',
    p_team_id::TEXT,
    jsonb_build_object(
      'role_type', p_role_type,
      'old_primary_user_id', v_old_primary_user_id::TEXT,
      'old_primary_email', v_old_primary_email,
      'new_primary_user_id', p_new_user_id::TEXT,
      'new_primary_email', v_new_primary_email,
      'affected_contracts', v_affected_contracts
    ),
    v_new_primary_email
  );

  RETURN QUERY
  SELECT tm.id,
         tm.tenant_id,
         tm.team_id,
         tm.user_id,
         tm.role_type,
         tm.is_primary,
         v_new_primary_email,
         v_new_primary_full_name,
         tm.created_at,
         tm.updated_at
  FROM public.team_members tm
  WHERE tm.id = v_existing_member_id;
END;
$$;


ALTER FUNCTION "public"."replace_primary_team_member"("p_tenant_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_actor_user_id" "text", "p_actor_email" "text", "p_actor_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_user_effective_role"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_fallback_role" "text" DEFAULT NULL::"text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role_key TEXT;
  v_legacy_role TEXT := UPPER(TRIM(COALESCE(p_fallback_role, '')));
BEGIN
  SELECT r.role_key
    INTO v_role_key
  FROM public.user_roles ur
  JOIN public.roles r
    ON r.id = ur.role_id
   AND r.tenant_id = ur.tenant_id
  WHERE ur.tenant_id = p_tenant_id
    AND ur.user_id = p_user_id
    AND ur.is_active = TRUE
    AND ur.deleted_at IS NULL
    AND r.is_active = TRUE
    AND r.deleted_at IS NULL
  ORDER BY CASE UPPER(r.role_key)
    WHEN 'SUPER_ADMIN' THEN 1
    WHEN 'LEGAL_ADMIN' THEN 2
    WHEN 'ADMIN' THEN 3
    WHEN 'LEGAL_TEAM' THEN 4
    WHEN 'HOD' THEN 5
    WHEN 'POC' THEN 6
    WHEN 'USER' THEN 7
    ELSE 99
  END,
  r.created_at ASC
  LIMIT 1;

  IF v_role_key IS NOT NULL AND TRIM(v_role_key) <> '' THEN
    RETURN UPPER(TRIM(v_role_key));
  END IF;

  IF v_legacy_role <> '' THEN
    RETURN v_legacy_role;
  END IF;

  RETURN 'USER';
END;
$$;


ALTER FUNCTION "public"."resolve_user_effective_role"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_fallback_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_contract_current_document_from_primary_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.document_kind = 'PRIMARY' AND NEW.deleted_at IS NULL THEN
    UPDATE public.contracts
    SET current_document_id = NEW.id,
        file_path = NEW.file_path,
        file_name = NEW.file_name,
        file_size_bytes = NEW.file_size_bytes,
        file_mime_type = NEW.file_mime_type,
        updated_at = NOW()
    WHERE tenant_id = NEW.tenant_id
      AND id = NEW.contract_id
      AND deleted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_contract_current_document_from_primary_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_contract_current_document"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  matched_document RECORD;
BEGIN
  IF NEW.current_document_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id
  INTO matched_document
  FROM public.contract_documents
  WHERE id = NEW.current_document_id
    AND tenant_id = NEW.tenant_id
    AND contract_id = NEW.id
    AND document_kind = 'PRIMARY'
    AND deleted_at IS NULL;

  IF matched_document.id IS NULL THEN
    RAISE EXCEPTION 'current_document_id must reference an active PRIMARY document for this contract and tenant';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_contract_current_document"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text" NOT NULL,
    "changes" "jsonb",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "target_email" "text",
    "note_text" "text",
    "event_sequence" bigint NOT NULL,
    "event_type" "public"."audit_event_type",
    "actor_email" "text",
    "actor_role" "text"
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


ALTER TABLE "public"."audit_logs" ALTER COLUMN "event_sequence" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."audit_logs_event_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."contract_activity_read_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "employee_id" "text" NOT NULL,
    "last_seen_event_sequence" bigint,
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."contract_activity_read_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_additional_approvers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "approver_employee_id" "text" NOT NULL,
    "approver_email" "text" NOT NULL,
    "sequence_order" integer NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "approved_at" timestamp with time zone,
    "created_by_employee_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "contract_additional_approvers_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'APPROVED'::"text", 'REJECTED'::"text", 'BYPASSED'::"text", 'SKIPPED'::"text"])))
);


ALTER TABLE "public"."contract_additional_approvers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_counterparties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "counterparty_name" "text" NOT NULL,
    "sequence_order" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "contract_counterparties_name_not_empty" CHECK (("char_length"(TRIM(BOTH FROM "counterparty_name")) > 0)),
    CONSTRAINT "contract_counterparties_sequence_positive" CHECK (("sequence_order" > 0))
);


ALTER TABLE "public"."contract_counterparties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "document_kind" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "file_mime_type" "text" NOT NULL,
    "uploaded_by_employee_id" "text" NOT NULL,
    "uploaded_by_email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "version_number" numeric(10,1) DEFAULT 1.0 NOT NULL,
    "uploaded_role" "text" DEFAULT 'SYSTEM'::"text" NOT NULL,
    "replaced_document_id" "uuid",
    "counterparty_id" "uuid",
    CONSTRAINT "contract_documents_file_size_bytes_check" CHECK (("file_size_bytes" > 0)),
    CONSTRAINT "contract_documents_kind_check" CHECK (("document_kind" = ANY (ARRAY['PRIMARY'::"text", 'COUNTERPARTY_SUPPORTING'::"text", 'EXECUTED_CONTRACT'::"text", 'AUDIT_CERTIFICATE'::"text"]))),
    CONSTRAINT "contract_documents_version_number_major_check" CHECK ((("version_number" >= 1.0) AND ("version_number" = "trunc"("version_number"))))
);


ALTER TABLE "public"."contract_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_legal_collaborators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "collaborator_employee_id" "text" NOT NULL,
    "collaborator_email" "text" NOT NULL,
    "created_by_employee_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "contract_legal_collaborators_email_lowercase_check" CHECK (("collaborator_email" = "lower"("collaborator_email")))
);


ALTER TABLE "public"."contract_legal_collaborators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_notification_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "envelope_id" "text",
    "recipient_email" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "notification_type" "text" NOT NULL,
    "template_id" integer NOT NULL,
    "provider_name" "text" NOT NULL,
    "provider_message_id" "text",
    "status" "text" NOT NULL,
    "retry_count" integer DEFAULT 0 NOT NULL,
    "max_retries" integer DEFAULT 2 NOT NULL,
    "next_retry_at" timestamp with time zone,
    "last_error" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contract_notification_deliveries_channel_check" CHECK (("channel" = 'EMAIL'::"text")),
    CONSTRAINT "contract_notification_deliveries_max_retries_check" CHECK (("max_retries" >= 0)),
    CONSTRAINT "contract_notification_deliveries_retry_count_check" CHECK (("retry_count" >= 0)),
    CONSTRAINT "contract_notification_deliveries_status_check" CHECK (("status" = ANY (ARRAY['SENT'::"text", 'FAILED'::"text"]))),
    CONSTRAINT "contract_notification_deliveries_type_check" CHECK (("notification_type" = ANY (ARRAY['SIGNATORY_LINK'::"text", 'SIGNING_COMPLETED'::"text", 'HOD_APPROVAL_REQUESTED'::"text", 'APPROVAL_REMINDER'::"text", 'ADDITIONAL_APPROVER_ADDED'::"text", 'LEGAL_INTERNAL_ASSIGNMENT'::"text", 'LEGAL_APPROVAL_RECEIVED_HOD'::"text", 'LEGAL_APPROVAL_RECEIVED_ADDITIONAL'::"text", 'LEGAL_RETURNED_TO_HOD'::"text", 'LEGAL_CONTRACT_REJECTED'::"text"])))
);


ALTER TABLE "public"."contract_notification_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_repository_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "user_email" "text" NOT NULL,
    "assignment_role" "text" NOT NULL,
    "source" "text" DEFAULT 'SYSTEM'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "contract_repository_assignments_assignment_role_check" CHECK (("assignment_role" = ANY (ARRAY['OWNER'::"text", 'COLLABORATOR'::"text", 'APPROVER'::"text"]))),
    CONSTRAINT "contract_repository_assignments_source_check" CHECK (("source" = ANY (ARRAY['SYSTEM'::"text", 'MANUAL'::"text"]))),
    CONSTRAINT "contract_repository_assignments_user_email_non_empty" CHECK (("btrim"("user_email") <> ''::"text"))
);


ALTER TABLE "public"."contract_repository_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_signatories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "signatory_email" "text" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "zoho_sign_envelope_id" "text" NOT NULL,
    "zoho_sign_recipient_id" "text" NOT NULL,
    "signed_at" timestamp with time zone,
    "created_by_employee_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "recipient_type" "text" DEFAULT 'EXTERNAL'::"text" NOT NULL,
    "routing_order" integer DEFAULT 1 NOT NULL,
    "field_config" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "envelope_source_document_id" "uuid",
    CONSTRAINT "contract_signatories_recipient_type_check" CHECK (("recipient_type" = ANY (ARRAY['INTERNAL'::"text", 'EXTERNAL'::"text"]))),
    CONSTRAINT "contract_signatories_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'SIGNED'::"text"])))
);


ALTER TABLE "public"."contract_signatories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_signing_preparation_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "recipients" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "fields" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by_employee_id" "text" NOT NULL,
    "updated_by_employee_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contract_signing_preparation_drafts_fields_array" CHECK (("jsonb_typeof"("fields") = 'array'::"text")),
    CONSTRAINT "contract_signing_preparation_drafts_recipients_array" CHECK (("jsonb_typeof"("recipients") = 'array'::"text"))
);


ALTER TABLE "public"."contract_signing_preparation_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_transition_graph" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "from_status" "text" NOT NULL,
    "to_status" "text" NOT NULL,
    "trigger_action" "text" NOT NULL,
    "allowed_roles" "text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contract_transition_graph_status_check" CHECK ((("from_status" = ANY (ARRAY['DRAFT'::"text", 'UPLOADED'::"text", 'HOD_PENDING'::"text", 'UNDER_REVIEW'::"text", 'PENDING_WITH_INTERNAL_STAKEHOLDERS'::"text", 'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::"text", 'OFFLINE_EXECUTION'::"text", 'ON_HOLD'::"text", 'COMPLETED'::"text", 'SIGNING'::"text", 'EXECUTED'::"text", 'VOID'::"text", 'REJECTED'::"text"])) AND ("to_status" = ANY (ARRAY['DRAFT'::"text", 'UPLOADED'::"text", 'HOD_PENDING'::"text", 'UNDER_REVIEW'::"text", 'PENDING_WITH_INTERNAL_STAKEHOLDERS'::"text", 'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::"text", 'OFFLINE_EXECUTION'::"text", 'ON_HOLD'::"text", 'COMPLETED'::"text", 'SIGNING'::"text", 'EXECUTED'::"text", 'VOID'::"text", 'REJECTED'::"text"]))))
);


ALTER TABLE "public"."contract_transition_graph" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "normalized_name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "contract_types_name_non_empty" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "contract_types_normalized_name_non_empty" CHECK (("btrim"("normalized_name") <> ''::"text"))
);


ALTER TABLE "public"."contract_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contracts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "uploaded_by_employee_id" "text" NOT NULL,
    "uploaded_by_email" "text" NOT NULL,
    "current_assignee_employee_id" "text" NOT NULL,
    "current_assignee_email" "text" NOT NULL,
    "status" "text" DEFAULT 'HOD_PENDING'::"text" NOT NULL,
    "row_version" integer DEFAULT 0 NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hod_approved_at" timestamp with time zone,
    "legal_approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "file_path" "text",
    "file_name" "text",
    "file_size_bytes" bigint,
    "file_mime_type" "text",
    "tat_deadline_at" timestamp with time zone,
    "tat_breached_at" timestamp with time zone,
    "signatory_name" "text" NOT NULL,
    "signatory_designation" "text" NOT NULL,
    "signatory_email" "text" NOT NULL,
    "background_of_request" "text" NOT NULL,
    "department_id" "uuid" NOT NULL,
    "budget_approved" boolean DEFAULT false NOT NULL,
    "request_created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contract_type_id" "uuid" NOT NULL,
    "workflow_stage" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "counterparty_name" "text",
    "current_document_id" "uuid",
    "void_reason" "text",
    "legal_effective_date" "date",
    "legal_termination_date" "date",
    "legal_notice_period" "text",
    "legal_auto_renewal" boolean,
    "upload_mode" "text" DEFAULT 'DEFAULT'::"text" NOT NULL,
    CONSTRAINT "contracts_background_non_empty" CHECK (("btrim"("background_of_request") <> ''::"text")),
    CONSTRAINT "contracts_file_size_positive" CHECK ((("file_size_bytes" IS NULL) OR ("file_size_bytes" > 0))),
    CONSTRAINT "contracts_signatory_designation_non_empty" CHECK (("btrim"("signatory_designation") <> ''::"text")),
    CONSTRAINT "contracts_signatory_email_format_check" CHECK ((("signatory_email" ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'::"text") OR ("upper"("btrim"("signatory_email")) = 'NA'::"text"))),
    CONSTRAINT "contracts_signatory_name_non_empty" CHECK (("btrim"("signatory_name") <> ''::"text")),
    CONSTRAINT "contracts_status_check" CHECK (("status" = ANY (ARRAY['DRAFT'::"text", 'UPLOADED'::"text", 'HOD_PENDING'::"text", 'UNDER_REVIEW'::"text", 'PENDING_WITH_INTERNAL_STAKEHOLDERS'::"text", 'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::"text", 'OFFLINE_EXECUTION'::"text", 'ON_HOLD'::"text", 'COMPLETED'::"text", 'SIGNING'::"text", 'EXECUTED'::"text", 'VOID'::"text", 'REJECTED'::"text"]))),
    CONSTRAINT "contracts_upload_mode_check" CHECK (("upload_mode" = ANY (ARRAY['DEFAULT'::"text", 'LEGAL_SEND_FOR_SIGNING'::"text"])))
);


ALTER TABLE "public"."contracts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."contracts_repository_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "tenant_id",
    "title",
    "status",
    "uploaded_by_employee_id",
    "uploaded_by_email",
    "current_assignee_employee_id",
    "current_assignee_email",
    "hod_approved_at",
    "tat_deadline_at",
    "tat_breached_at",
    "created_at",
    "updated_at",
        CASE
            WHEN ("hod_approved_at" IS NULL) THEN NULL::integer
            ELSE "public"."business_day_diff"((("hod_approved_at" AT TIME ZONE 'UTC'::"text"))::"date", ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::"text"))::"date")
        END AS "aging_business_days",
        CASE
            WHEN (("tat_deadline_at" IS NOT NULL) AND (CURRENT_TIMESTAMP > "tat_deadline_at") AND ("status" <> ALL (ARRAY['COMPLETED'::"text", 'EXECUTED'::"text", 'REJECTED'::"text"]))) THEN true
            ELSE false
        END AS "is_tat_breached",
        CASE
            WHEN (("tat_deadline_at" IS NOT NULL) AND (CURRENT_TIMESTAMP <= "tat_deadline_at") AND ("status" <> ALL (ARRAY['COMPLETED'::"text", 'EXECUTED'::"text", 'REJECTED'::"text"])) AND ("public"."business_day_diff"(((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::"text"))::"date", (("tat_deadline_at" AT TIME ZONE 'UTC'::"text"))::"date") = 1)) THEN true
            ELSE false
        END AS "near_breach",
    "department_id",
    "request_created_at",
    "void_reason",
    "background_of_request"
   FROM "public"."contracts" "c"
  WHERE ("deleted_at" IS NULL);


ALTER VIEW "public"."contracts_repository_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_legal_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "department_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_by" "uuid",
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."department_legal_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employees" (
    "employee_id" "text" NOT NULL,
    "password_hash" "text",
    "email" "text",
    "full_name" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" NOT NULL,
    "deleted_at" timestamp with time zone,
    "role" "text" DEFAULT 'viewer'::"text",
    "id" "uuid" DEFAULT "gen_random_uuid"()
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."holidays" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "holiday_date" "date" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'PUBLIC'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "response_data" "jsonb" NOT NULL,
    "status_code" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."idempotency_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."master_counterparties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "master_counterparties_name_non_empty" CHECK (("char_length"(TRIM(BOTH FROM "name")) > 0))
);


ALTER TABLE "public"."master_counterparties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "permission_key" "text" NOT NULL,
    "module_name" "text" NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "role_key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_role_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role_type" "text" NOT NULL,
    "active_flag" boolean DEFAULT true NOT NULL,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "replaced_by" "uuid",
    "replaced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "team_role_mappings_role_type_check" CHECK (("role_type" = ANY (ARRAY['POC'::"text", 'HOD'::"text"])))
);


ALTER TABLE "public"."team_role_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "poc_email" "text",
    "hod_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "poc_name" "text",
    "hod_name" "text"
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "region" "text" DEFAULT 'us-east-1'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_by" "uuid",
    "revoked_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "password_hash" "text",
    "role" "text" NOT NULL,
    "team_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "token_version" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "users_email_domain_check" CHECK (("lower"(TRIM(BOTH FROM "email")) ~ '^[a-z0-9._%+\-]+@(nxtwave\.co\.in|nxtwave\.in|nxtwave\.tech)$'::"text")),
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['USER'::"text", 'POC'::"text", 'HOD'::"text", 'LEGAL_TEAM'::"text", 'ADMIN'::"text", 'LEGAL_ADMIN'::"text", 'SUPER_ADMIN'::"text", 'SYSTEM'::"text"]))),
    CONSTRAINT "users_token_version_non_negative" CHECK (("token_version" >= 0))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."zoho_sign_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "envelope_id" "text" NOT NULL,
    "recipient_email" "text",
    "event_type" "text" NOT NULL,
    "event_key" "text" NOT NULL,
    "signer_ip" "text",
    "payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."zoho_sign_webhook_events" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_activity_read_state"
    ADD CONSTRAINT "contract_activity_read_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_activity_read_state"
    ADD CONSTRAINT "contract_activity_read_state_unique" UNIQUE ("tenant_id", "contract_id", "employee_id");



ALTER TABLE ONLY "public"."contract_additional_approvers"
    ADD CONSTRAINT "contract_additional_approvers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_additional_approvers"
    ADD CONSTRAINT "contract_additional_approvers_sequence_unique" UNIQUE ("tenant_id", "contract_id", "sequence_order");



ALTER TABLE ONLY "public"."contract_counterparties"
    ADD CONSTRAINT "contract_counterparties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_documents"
    ADD CONSTRAINT "contract_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_legal_collaborators"
    ADD CONSTRAINT "contract_legal_collaborators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_notification_deliveries"
    ADD CONSTRAINT "contract_notification_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_repository_assignments"
    ADD CONSTRAINT "contract_repository_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_signatories"
    ADD CONSTRAINT "contract_signatories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_signing_preparation_drafts"
    ADD CONSTRAINT "contract_signing_preparation_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_signing_preparation_drafts"
    ADD CONSTRAINT "contract_signing_preparation_drafts_unique" UNIQUE ("tenant_id", "contract_id");



ALTER TABLE ONLY "public"."contract_transition_graph"
    ADD CONSTRAINT "contract_transition_graph_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_transition_graph"
    ADD CONSTRAINT "contract_transition_graph_unique_edge" UNIQUE ("tenant_id", "from_status", "to_status", "trigger_action");



ALTER TABLE ONLY "public"."contract_types"
    ADD CONSTRAINT "contract_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_types"
    ADD CONSTRAINT "contract_types_tenant_id_id_unique" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "public"."contract_types"
    ADD CONSTRAINT "contract_types_tenant_normalized_unique" UNIQUE ("tenant_id", "normalized_name");



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_legal_assignments"
    ADD CONSTRAINT "department_legal_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_legal_assignments"
    ADD CONSTRAINT "department_legal_assignments_tenant_department_user_unique" UNIQUE ("tenant_id", "department_id", "user_id");



ALTER TABLE ONLY "public"."zoho_sign_webhook_events"
    ADD CONSTRAINT "docusign_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("employee_id");



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_holiday_date_type_key" UNIQUE ("holiday_date", "type");



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_key_tenant_id_key" UNIQUE ("key", "tenant_id");



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_counterparties"
    ADD CONSTRAINT "master_counterparties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_tenant_permission_key_unique" UNIQUE ("tenant_id", "permission_key");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_tenant_role_permission_unique" UNIQUE ("tenant_id", "role_id", "permission_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_tenant_role_key_unique" UNIQUE ("tenant_id", "role_key");



ALTER TABLE ONLY "public"."team_role_mappings"
    ADD CONSTRAINT "team_role_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_role_mappings"
    ADD CONSTRAINT "team_role_mappings_tenant_team_email_role_unique" UNIQUE ("tenant_id", "team_id", "email", "role_type");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_name_unique" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_unique" UNIQUE ("tenant_id", "email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action");



CREATE INDEX "idx_audit_logs_action_trgm" ON "public"."audit_logs" USING "gin" ("action" "public"."gin_trgm_ops");



CREATE INDEX "idx_audit_logs_contract_event_type" ON "public"."audit_logs" USING "btree" ("tenant_id", "resource_type", "resource_id", "event_type", "event_sequence" DESC);



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at");



CREATE INDEX "idx_audit_logs_resource_type" ON "public"."audit_logs" USING "btree" ("resource_type");



CREATE INDEX "idx_audit_logs_resource_type_trgm" ON "public"."audit_logs" USING "gin" ("resource_type" "public"."gin_trgm_ops");



CREATE INDEX "idx_audit_logs_tenant_created" ON "public"."audit_logs" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_tenant_id" ON "public"."audit_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_audit_logs_timeline_order" ON "public"."audit_logs" USING "btree" ("tenant_id", "resource_type", "resource_id", "event_sequence");



CREATE INDEX "idx_audit_logs_user_created_desc" ON "public"."audit_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_contract_activity_read_state_contract" ON "public"."contract_activity_read_state" USING "btree" ("tenant_id", "contract_id");



CREATE INDEX "idx_contract_activity_read_state_contract_id" ON "public"."contract_activity_read_state" USING "btree" ("contract_id");



CREATE INDEX "idx_contract_activity_read_state_employee" ON "public"."contract_activity_read_state" USING "btree" ("tenant_id", "employee_id");



CREATE INDEX "idx_contract_additional_approvers_contract_id" ON "public"."contract_additional_approvers" USING "btree" ("contract_id");



CREATE INDEX "idx_contract_additional_approvers_lookup" ON "public"."contract_additional_approvers" USING "btree" ("tenant_id", "contract_id", "status", "sequence_order") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_counterparties_contract" ON "public"."contract_counterparties" USING "btree" ("tenant_id", "contract_id", "created_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_counterparties_contract_id" ON "public"."contract_counterparties" USING "btree" ("contract_id");



CREATE UNIQUE INDEX "idx_contract_counterparties_tenant_id_id" ON "public"."contract_counterparties" USING "btree" ("tenant_id", "id");



CREATE UNIQUE INDEX "idx_contract_counterparties_unique_sequence" ON "public"."contract_counterparties" USING "btree" ("tenant_id", "contract_id", "sequence_order") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_documents_contract_id" ON "public"."contract_documents" USING "btree" ("contract_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_documents_counterparty_id" ON "public"."contract_documents" USING "btree" ("counterparty_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_documents_current_lookup" ON "public"."contract_documents" USING "btree" ("tenant_id", "contract_id", "document_kind", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_contract_documents_primary_version_unique" ON "public"."contract_documents" USING "btree" ("tenant_id", "contract_id", "version_number") WHERE (("deleted_at" IS NULL) AND ("document_kind" = 'PRIMARY'::"text"));



CREATE INDEX "idx_contract_documents_replaced_document_id" ON "public"."contract_documents" USING "btree" ("replaced_document_id");



CREATE INDEX "idx_contract_documents_tenant_contract_created" ON "public"."contract_documents" USING "btree" ("tenant_id", "contract_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_documents_tenant_id_counterparty_id" ON "public"."contract_documents" USING "btree" ("tenant_id", "counterparty_id");



CREATE INDEX "idx_contract_legal_collaborators_contract_id" ON "public"."contract_legal_collaborators" USING "btree" ("contract_id");



CREATE INDEX "idx_contract_legal_collaborators_contract_lookup" ON "public"."contract_legal_collaborators" USING "btree" ("tenant_id", "contract_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_legal_collaborators_employee_lookup" ON "public"."contract_legal_collaborators" USING "btree" ("tenant_id", "collaborator_employee_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_legal_collaborators_tenant_id" ON "public"."contract_legal_collaborators" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_contract_legal_collaborators_unique_active" ON "public"."contract_legal_collaborators" USING "btree" ("tenant_id", "contract_id", "collaborator_employee_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_notification_deliveries_contract_created" ON "public"."contract_notification_deliveries" USING "btree" ("tenant_id", "contract_id", "created_at" DESC);



CREATE INDEX "idx_contract_notification_deliveries_contract_id" ON "public"."contract_notification_deliveries" USING "btree" ("contract_id");



CREATE INDEX "idx_contract_notification_deliveries_retry" ON "public"."contract_notification_deliveries" USING "btree" ("tenant_id", "status", "next_retry_at") WHERE ("status" = 'FAILED'::"text");



CREATE INDEX "idx_contract_repository_assignments_contract_id" ON "public"."contract_repository_assignments" USING "btree" ("contract_id");



CREATE INDEX "idx_contract_repository_assignments_tenant_contract" ON "public"."contract_repository_assignments" USING "btree" ("tenant_id", "contract_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_repository_assignments_tenant_id" ON "public"."contract_repository_assignments" USING "btree" ("tenant_id");



CREATE INDEX "idx_contract_repository_assignments_tenant_user" ON "public"."contract_repository_assignments" USING "btree" ("tenant_id", "user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_signatories_contract_id" ON "public"."contract_signatories" USING "btree" ("contract_id");



CREATE INDEX "idx_contract_signatories_contract_status" ON "public"."contract_signatories" USING "btree" ("tenant_id", "contract_id", "status", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_signatories_envelope_source_document" ON "public"."contract_signatories" USING "btree" ("tenant_id", "envelope_source_document_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_signatories_envelope_source_document_id" ON "public"."contract_signatories" USING "btree" ("envelope_source_document_id");



CREATE INDEX "idx_contract_signatories_routing_order" ON "public"."contract_signatories" USING "btree" ("tenant_id", "contract_id", "routing_order", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_signatories_tenant_id" ON "public"."contract_signatories" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_contract_signatories_zoho_sign_envelope_recipient_unique" ON "public"."contract_signatories" USING "btree" ("tenant_id", "zoho_sign_envelope_id", "zoho_sign_recipient_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contract_signing_preparation_drafts_contract" ON "public"."contract_signing_preparation_drafts" USING "btree" ("tenant_id", "contract_id");



CREATE INDEX "idx_contract_signing_preparation_drafts_contract_id" ON "public"."contract_signing_preparation_drafts" USING "btree" ("contract_id");



CREATE INDEX "idx_contract_transition_graph_tenant" ON "public"."contract_transition_graph" USING "btree" ("tenant_id", "is_active");



CREATE INDEX "idx_contract_types_tenant_active" ON "public"."contract_types" USING "btree" ("tenant_id", "is_active") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_assignee" ON "public"."contracts" USING "btree" ("tenant_id", "current_assignee_employee_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_created_at" ON "public"."contracts" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_contracts_current_document_id" ON "public"."contracts" USING "btree" ("current_document_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_department_id" ON "public"."contracts" USING "btree" ("department_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_tat_deadline_at" ON "public"."contracts" USING "btree" ("tat_deadline_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_tenant_contract_type" ON "public"."contracts" USING "btree" ("tenant_id", "contract_type_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_tenant_file_path" ON "public"."contracts" USING "btree" ("tenant_id", "file_path") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_tenant_hod_approved_at" ON "public"."contracts" USING "btree" ("tenant_id", "hod_approved_at" DESC NULLS LAST) WHERE (("deleted_at" IS NULL) AND ("hod_approved_at" IS NOT NULL));



CREATE INDEX "idx_contracts_tenant_id_contract_type_id" ON "public"."contracts" USING "btree" ("tenant_id", "contract_type_id");



CREATE INDEX "idx_contracts_tenant_request_created_at" ON "public"."contracts" USING "btree" ("tenant_id", "request_created_at" DESC NULLS LAST) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_tenant_status" ON "public"."contracts" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_contracts_tenant_status_created_at" ON "public"."contracts" USING "btree" ("tenant_id", "status", "created_at" DESC NULLS LAST) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_tenant_tat_deadline_at" ON "public"."contracts" USING "btree" ("tenant_id", "tat_deadline_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contracts_tenant_upload_mode" ON "public"."contracts" USING "btree" ("tenant_id", "upload_mode") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_department_legal_assignments_active_unique" ON "public"."department_legal_assignments" USING "btree" ("tenant_id", "department_id", "user_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_department_legal_assignments_assigned_by" ON "public"."department_legal_assignments" USING "btree" ("assigned_by");



CREATE INDEX "idx_department_legal_assignments_department_id" ON "public"."department_legal_assignments" USING "btree" ("department_id");



CREATE INDEX "idx_department_legal_assignments_revoked_by" ON "public"."department_legal_assignments" USING "btree" ("revoked_by");



CREATE INDEX "idx_department_legal_assignments_tenant_department" ON "public"."department_legal_assignments" USING "btree" ("tenant_id", "department_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_department_legal_assignments_tenant_user" ON "public"."department_legal_assignments" USING "btree" ("tenant_id", "user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_department_legal_assignments_user_id" ON "public"."department_legal_assignments" USING "btree" ("user_id");



CREATE INDEX "idx_employees_deleted_at" ON "public"."employees" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_employees_email" ON "public"."employees" USING "btree" ("email");



CREATE INDEX "idx_employees_email_tenant" ON "public"."employees" USING "btree" ("email", "tenant_id");



CREATE INDEX "idx_employees_id" ON "public"."employees" USING "btree" ("id");



CREATE INDEX "idx_employees_is_active" ON "public"."employees" USING "btree" ("is_active");



CREATE INDEX "idx_employees_tenant_id" ON "public"."employees" USING "btree" ("tenant_id");



CREATE INDEX "idx_holidays_holiday_date" ON "public"."holidays" USING "btree" ("holiday_date");



CREATE INDEX "idx_holidays_holiday_date_type" ON "public"."holidays" USING "btree" ("holiday_date", "type");



CREATE INDEX "idx_idempotency_keys_composite" ON "public"."idempotency_keys" USING "btree" ("key", "tenant_id");



CREATE INDEX "idx_idempotency_keys_expires_at" ON "public"."idempotency_keys" USING "btree" ("expires_at");



CREATE INDEX "idx_idempotency_keys_tenant_id" ON "public"."idempotency_keys" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_master_counterparties_tenant_name_unique" ON "public"."master_counterparties" USING "btree" ("tenant_id", "name");



CREATE INDEX "idx_permissions_tenant_active" ON "public"."permissions" USING "btree" ("tenant_id", "permission_key") WHERE (("deleted_at" IS NULL) AND ("is_active" = true));



CREATE INDEX "idx_role_permissions_created_by" ON "public"."role_permissions" USING "btree" ("created_by");



CREATE INDEX "idx_role_permissions_permission_id" ON "public"."role_permissions" USING "btree" ("permission_id");



CREATE INDEX "idx_role_permissions_role_id" ON "public"."role_permissions" USING "btree" ("role_id");



CREATE INDEX "idx_role_permissions_tenant_role" ON "public"."role_permissions" USING "btree" ("tenant_id", "role_id") WHERE (("deleted_at" IS NULL) AND ("is_active" = true));



CREATE INDEX "idx_roles_created_by" ON "public"."roles" USING "btree" ("created_by");



CREATE INDEX "idx_roles_tenant_active" ON "public"."roles" USING "btree" ("tenant_id", "role_key") WHERE (("deleted_at" IS NULL) AND ("is_active" = true));



CREATE UNIQUE INDEX "idx_team_role_mappings_active_primary_role_unique" ON "public"."team_role_mappings" USING "btree" ("tenant_id", "team_id", "role_type") WHERE (("active_flag" = true) AND ("deleted_at" IS NULL) AND ("role_type" = ANY (ARRAY['POC'::"text", 'HOD'::"text"])));



CREATE INDEX "idx_team_role_mappings_assigned_by" ON "public"."team_role_mappings" USING "btree" ("assigned_by");



CREATE INDEX "idx_team_role_mappings_replaced_by" ON "public"."team_role_mappings" USING "btree" ("replaced_by");



CREATE INDEX "idx_team_role_mappings_team_id" ON "public"."team_role_mappings" USING "btree" ("team_id");



CREATE INDEX "idx_team_role_mappings_tenant_email" ON "public"."team_role_mappings" USING "btree" ("tenant_id", "lower"("email")) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_team_role_mappings_tenant_team" ON "public"."team_role_mappings" USING "btree" ("tenant_id", "team_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_teams_tenant_id_id" ON "public"."teams" USING "btree" ("tenant_id", "id");



CREATE INDEX "idx_teams_tenant_name" ON "public"."teams" USING "btree" ("tenant_id", "name") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tenants_deleted_at" ON "public"."tenants" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tenants_region" ON "public"."tenants" USING "btree" ("region");



CREATE UNIQUE INDEX "idx_user_roles_active_unique" ON "public"."user_roles" USING "btree" ("tenant_id", "user_id", "role_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_user_roles_assigned_by" ON "public"."user_roles" USING "btree" ("assigned_by");



CREATE INDEX "idx_user_roles_revoked_by" ON "public"."user_roles" USING "btree" ("revoked_by");



CREATE INDEX "idx_user_roles_role_id" ON "public"."user_roles" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_tenant_id" ON "public"."user_roles" USING "btree" ("tenant_id");



CREATE INDEX "idx_user_roles_tenant_user" ON "public"."user_roles" USING "btree" ("tenant_id", "user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_user_roles_user_id" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_users_tenant_email" ON "public"."users" USING "btree" ("tenant_id", "email") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_users_tenant_role" ON "public"."users" USING "btree" ("tenant_id", "role") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_users_tenant_team" ON "public"."users" USING "btree" ("tenant_id", "team_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_zoho_sign_webhook_events_contract_created" ON "public"."zoho_sign_webhook_events" USING "btree" ("tenant_id", "contract_id", "created_at" DESC);



CREATE INDEX "idx_zoho_sign_webhook_events_contract_id" ON "public"."zoho_sign_webhook_events" USING "btree" ("contract_id");



CREATE UNIQUE INDEX "idx_zoho_sign_webhook_events_event_key" ON "public"."zoho_sign_webhook_events" USING "btree" ("tenant_id", "event_key");



CREATE UNIQUE INDEX "uq_contract_repository_assignments_unique_active" ON "public"."contract_repository_assignments" USING "btree" ("tenant_id", "contract_id", "user_email", "assignment_role") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "ux_contract_transition_graph_active_decision" ON "public"."contract_transition_graph" USING "btree" ("tenant_id", "from_status", "trigger_action") WHERE ("is_active" = true);



CREATE OR REPLACE TRIGGER "audit_logs_immutable" BEFORE DELETE OR UPDATE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_audit_immutable"();



CREATE OR REPLACE TRIGGER "enforce_contract_department_tenant_match_trigger" BEFORE INSERT OR UPDATE OF "department_id", "tenant_id" ON "public"."contracts" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_contract_department_tenant_match"();



CREATE OR REPLACE TRIGGER "enforce_contract_tat_mutability_trigger" BEFORE UPDATE ON "public"."contracts" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_contract_tat_mutability"();



CREATE OR REPLACE TRIGGER "sync_contract_current_document_from_primary_insert_trigger" AFTER INSERT ON "public"."contract_documents" FOR EACH ROW EXECUTE FUNCTION "public"."sync_contract_current_document_from_primary_insert"();



CREATE OR REPLACE TRIGGER "update_contract_activity_read_state_updated_at" BEFORE UPDATE ON "public"."contract_activity_read_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contract_additional_approvers_updated_at" BEFORE UPDATE ON "public"."contract_additional_approvers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contract_counterparties_updated_at" BEFORE UPDATE ON "public"."contract_counterparties" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contract_documents_updated_at" BEFORE UPDATE ON "public"."contract_documents" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contract_legal_collaborators_updated_at" BEFORE UPDATE ON "public"."contract_legal_collaborators" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contract_signatories_updated_at" BEFORE UPDATE ON "public"."contract_signatories" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contract_signing_preparation_drafts_updated_at" BEFORE UPDATE ON "public"."contract_signing_preparation_drafts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contract_transition_graph_updated_at" BEFORE UPDATE ON "public"."contract_transition_graph" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contract_types_updated_at" BEFORE UPDATE ON "public"."contract_types" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contracts_updated_at" BEFORE UPDATE ON "public"."contracts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_department_legal_assignments_updated_at" BEFORE UPDATE ON "public"."department_legal_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_employees_updated_at" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_permissions_updated_at" BEFORE UPDATE ON "public"."permissions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_team_role_mappings_updated_at" BEFORE UPDATE ON "public"."team_role_mappings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_teams_updated_at" BEFORE UPDATE ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "validate_contract_current_document_trigger" BEFORE INSERT OR UPDATE OF "current_document_id" ON "public"."contracts" FOR EACH ROW EXECUTE FUNCTION "public"."validate_contract_current_document"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_activity_read_state"
    ADD CONSTRAINT "contract_activity_read_state_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_activity_read_state"
    ADD CONSTRAINT "contract_activity_read_state_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_additional_approvers"
    ADD CONSTRAINT "contract_additional_approvers_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_additional_approvers"
    ADD CONSTRAINT "contract_additional_approvers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_counterparties"
    ADD CONSTRAINT "contract_counterparties_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_counterparties"
    ADD CONSTRAINT "contract_counterparties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_documents"
    ADD CONSTRAINT "contract_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_documents"
    ADD CONSTRAINT "contract_documents_counterparty_tenant_fkey" FOREIGN KEY ("tenant_id", "counterparty_id") REFERENCES "public"."contract_counterparties"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contract_documents"
    ADD CONSTRAINT "contract_documents_replaced_document_id_fkey" FOREIGN KEY ("replaced_document_id") REFERENCES "public"."contract_documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contract_documents"
    ADD CONSTRAINT "contract_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_legal_collaborators"
    ADD CONSTRAINT "contract_legal_collaborators_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_legal_collaborators"
    ADD CONSTRAINT "contract_legal_collaborators_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_notification_deliveries"
    ADD CONSTRAINT "contract_notification_deliveries_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_notification_deliveries"
    ADD CONSTRAINT "contract_notification_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_repository_assignments"
    ADD CONSTRAINT "contract_repository_assignments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_repository_assignments"
    ADD CONSTRAINT "contract_repository_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_signatories"
    ADD CONSTRAINT "contract_signatories_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_signatories"
    ADD CONSTRAINT "contract_signatories_envelope_source_document_fk" FOREIGN KEY ("envelope_source_document_id") REFERENCES "public"."contract_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contract_signatories"
    ADD CONSTRAINT "contract_signatories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_signing_preparation_drafts"
    ADD CONSTRAINT "contract_signing_preparation_drafts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_signing_preparation_drafts"
    ADD CONSTRAINT "contract_signing_preparation_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_transition_graph"
    ADD CONSTRAINT "contract_transition_graph_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_types"
    ADD CONSTRAINT "contract_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_contract_type_fk" FOREIGN KEY ("tenant_id", "contract_type_id") REFERENCES "public"."contract_types"("tenant_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_current_document_id_fkey" FOREIGN KEY ("current_document_id") REFERENCES "public"."contract_documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_department_fk" FOREIGN KEY ("department_id") REFERENCES "public"."teams"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_legal_assignments"
    ADD CONSTRAINT "department_legal_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."department_legal_assignments"
    ADD CONSTRAINT "department_legal_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_legal_assignments"
    ADD CONSTRAINT "department_legal_assignments_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."department_legal_assignments"
    ADD CONSTRAINT "department_legal_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_legal_assignments"
    ADD CONSTRAINT "department_legal_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."master_counterparties"
    ADD CONSTRAINT "master_counterparties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_role_mappings"
    ADD CONSTRAINT "team_role_mappings_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_role_mappings"
    ADD CONSTRAINT "team_role_mappings_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_role_mappings"
    ADD CONSTRAINT "team_role_mappings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_role_mappings"
    ADD CONSTRAINT "team_role_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zoho_sign_webhook_events"
    ADD CONSTRAINT "zoho_sign_webhook_events_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zoho_sign_webhook_events"
    ADD CONSTRAINT "zoho_sign_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_tenant_isolation" ON "public"."audit_logs" USING (("tenant_id" = ((( SELECT "auth"."jwt"() AS "jwt") ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = ((( SELECT "auth"."jwt"() AS "jwt") ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_activity_read_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_activity_read_state_tenant_isolation" ON "public"."contract_activity_read_state" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_additional_approvers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_additional_approvers_tenant_isolation" ON "public"."contract_additional_approvers" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_counterparties" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_counterparties_tenant_isolation" ON "public"."contract_counterparties" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_documents_tenant_isolation" ON "public"."contract_documents" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_legal_collaborators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_legal_collaborators_tenant_isolation" ON "public"."contract_legal_collaborators" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_notification_deliveries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_notification_deliveries_tenant_isolation" ON "public"."contract_notification_deliveries" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_repository_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_repository_assignments_service_role_all" ON "public"."contract_repository_assignments" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "contract_repository_assignments_tenant_select" ON "public"."contract_repository_assignments" FOR SELECT USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_signatories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_signatories_tenant_isolation" ON "public"."contract_signatories" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_signing_preparation_drafts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_signing_preparation_drafts_tenant_isolation" ON "public"."contract_signing_preparation_drafts" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_transition_graph" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_transition_graph_tenant_isolation" ON "public"."contract_transition_graph" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contract_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contract_types_tenant_isolation" ON "public"."contract_types" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."contracts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contracts_tenant_isolation" ON "public"."contracts" USING (("tenant_id" = ((( SELECT "auth"."jwt"() AS "jwt") ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = ((( SELECT "auth"."jwt"() AS "jwt") ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."department_legal_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "department_legal_assignments_tenant_isolation" ON "public"."department_legal_assignments" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employees_tenant_isolation" ON "public"."employees" USING (("tenant_id" = ((( SELECT "auth"."jwt"() AS "jwt") ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = ((( SELECT "auth"."jwt"() AS "jwt") ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."idempotency_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "idempotency_keys_tenant_isolation" ON "public"."idempotency_keys" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."master_counterparties" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_counterparties_tenant_isolation" ON "public"."master_counterparties" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permissions_tenant_isolation" ON "public"."permissions" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_tenant_isolation" ON "public"."role_permissions" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_tenant_isolation" ON "public"."roles" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."team_role_mappings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_role_mappings_tenant_isolation" ON "public"."team_role_mappings" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teams_tenant_isolation" ON "public"."teams" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_tenant_isolation" ON "public"."user_roles" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_tenant_isolation" ON "public"."users" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));



ALTER TABLE "public"."zoho_sign_webhook_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "zoho_sign_webhook_events_tenant_isolation" ON "public"."zoho_sign_webhook_events" USING (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid")) WITH CHECK (("tenant_id" = (("auth"."jwt"() ->> 'tenant_id'::"text"))::"uuid"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."admin_assign_primary_team_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_assign_primary_team_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_assign_primary_team_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_assign_primary_team_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_change_user_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_target_user_id" "uuid", "p_role_key" "text", "p_operation" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_change_user_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_target_user_id" "uuid", "p_role_key" "text", "p_operation" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_change_user_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_target_user_id" "uuid", "p_role_key" "text", "p_operation" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_change_user_role"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_target_user_id" "uuid", "p_role_key" "text", "p_operation" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_create_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_create_department_with_emails"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_poc_email" "text", "p_hod_email" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_department_with_emails"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_poc_email" "text", "p_hod_email" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_department_with_emails"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_poc_email" "text", "p_hod_email" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_department_with_emails"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_department_name" "text", "p_poc_email" "text", "p_hod_email" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_new_name" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_new_name" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_new_name" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_replace_team_role_email"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_role_type" "text", "p_new_email" "text", "p_new_name" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_department_legal_matrix"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_legal_user_ids" "uuid"[], "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_department_legal_matrix"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_legal_user_ids" "uuid"[], "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_department_legal_matrix"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_legal_user_ids" "uuid"[], "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_department_legal_matrix"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_legal_user_ids" "uuid"[], "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_update_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_operation" "text", "p_department_name" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_update_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_operation" "text", "p_department_name" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_operation" "text", "p_department_name" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_department"("p_tenant_id" "uuid", "p_admin_user_id" "uuid", "p_team_id" "uuid", "p_operation" "text", "p_department_name" "text", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."business_day_add"("start_date" "date", "days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."business_day_add"("start_date" "date", "days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."business_day_add"("start_date" "date", "days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."business_day_diff"("start_date" "date", "end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."business_day_diff"("start_date" "date", "end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."business_day_diff"("start_date" "date", "end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_contract_primary_document_version"("p_tenant_id" "uuid", "p_contract_id" "uuid", "p_display_name" "text", "p_file_name" "text", "p_file_path" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_contract_primary_document_version"("p_tenant_id" "uuid", "p_contract_id" "uuid", "p_display_name" "text", "p_file_name" "text", "p_file_path" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_contract_primary_document_version"("p_tenant_id" "uuid", "p_contract_id" "uuid", "p_display_name" "text", "p_file_name" "text", "p_file_path" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_contract_with_audit"("p_contract_id" "uuid", "p_tenant_id" "uuid", "p_title" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text", "p_file_path" "text", "p_file_name" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_signatory_name" "text", "p_signatory_designation" "text", "p_signatory_email" "text", "p_background_of_request" "text", "p_department_id" "uuid", "p_contract_type_id" "uuid", "p_budget_approved" boolean, "p_upload_mode" "text", "p_bypass_hod_approval" boolean, "p_bypass_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_contract_with_audit"("p_contract_id" "uuid", "p_tenant_id" "uuid", "p_title" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text", "p_file_path" "text", "p_file_name" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_signatory_name" "text", "p_signatory_designation" "text", "p_signatory_email" "text", "p_background_of_request" "text", "p_department_id" "uuid", "p_contract_type_id" "uuid", "p_budget_approved" boolean, "p_upload_mode" "text", "p_bypass_hod_approval" boolean, "p_bypass_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_contract_with_audit"("p_contract_id" "uuid", "p_tenant_id" "uuid", "p_title" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text", "p_file_path" "text", "p_file_name" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_signatory_name" "text", "p_signatory_designation" "text", "p_signatory_email" "text", "p_background_of_request" "text", "p_department_id" "uuid", "p_contract_type_id" "uuid", "p_budget_approved" boolean, "p_upload_mode" "text", "p_bypass_hod_approval" boolean, "p_bypass_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_contract_with_audit"("p_contract_id" "uuid", "p_tenant_id" "uuid", "p_title" "text", "p_uploaded_by_employee_id" "text", "p_uploaded_by_email" "text", "p_uploaded_by_role" "text", "p_file_path" "text", "p_file_name" "text", "p_file_size_bytes" bigint, "p_file_mime_type" "text", "p_signatory_name" "text", "p_signatory_designation" "text", "p_signatory_email" "text", "p_background_of_request" "text", "p_department_id" "uuid", "p_contract_type_id" "uuid", "p_budget_approved" boolean, "p_upload_mode" "text", "p_bypass_hod_approval" boolean, "p_bypass_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_contract_department_tenant_match"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_contract_department_tenant_match"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_contract_department_tenant_match"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_contract_tat_mutability"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_contract_tat_mutability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_contract_tat_mutability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_audit_immutable"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_audit_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_audit_immutable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



REVOKE ALL ON FUNCTION "public"."replace_primary_team_member"("p_tenant_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_actor_user_id" "text", "p_actor_email" "text", "p_actor_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_primary_team_member"("p_tenant_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_actor_user_id" "text", "p_actor_email" "text", "p_actor_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."replace_primary_team_member"("p_tenant_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_actor_user_id" "text", "p_actor_email" "text", "p_actor_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_primary_team_member"("p_tenant_id" "uuid", "p_team_id" "uuid", "p_new_user_id" "uuid", "p_role_type" "text", "p_actor_user_id" "text", "p_actor_email" "text", "p_actor_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_user_effective_role"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_fallback_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_user_effective_role"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_fallback_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_user_effective_role"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_fallback_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_user_effective_role"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_fallback_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_contract_current_document_from_primary_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_contract_current_document_from_primary_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_contract_current_document_from_primary_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_contract_current_document"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_contract_current_document"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_contract_current_document"() TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";


















GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_logs_event_sequence_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_logs_event_sequence_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_logs_event_sequence_seq" TO "service_role";



GRANT ALL ON TABLE "public"."contract_activity_read_state" TO "anon";
GRANT ALL ON TABLE "public"."contract_activity_read_state" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_activity_read_state" TO "service_role";



GRANT ALL ON TABLE "public"."contract_additional_approvers" TO "anon";
GRANT ALL ON TABLE "public"."contract_additional_approvers" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_additional_approvers" TO "service_role";



GRANT ALL ON TABLE "public"."contract_counterparties" TO "anon";
GRANT ALL ON TABLE "public"."contract_counterparties" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_counterparties" TO "service_role";



GRANT ALL ON TABLE "public"."contract_documents" TO "anon";
GRANT ALL ON TABLE "public"."contract_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_documents" TO "service_role";



GRANT ALL ON TABLE "public"."contract_legal_collaborators" TO "anon";
GRANT ALL ON TABLE "public"."contract_legal_collaborators" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_legal_collaborators" TO "service_role";



GRANT ALL ON TABLE "public"."contract_notification_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."contract_notification_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_notification_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."contract_repository_assignments" TO "anon";
GRANT ALL ON TABLE "public"."contract_repository_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_repository_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."contract_signatories" TO "anon";
GRANT ALL ON TABLE "public"."contract_signatories" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_signatories" TO "service_role";



GRANT ALL ON TABLE "public"."contract_signing_preparation_drafts" TO "anon";
GRANT ALL ON TABLE "public"."contract_signing_preparation_drafts" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_signing_preparation_drafts" TO "service_role";



GRANT ALL ON TABLE "public"."contract_transition_graph" TO "anon";
GRANT ALL ON TABLE "public"."contract_transition_graph" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_transition_graph" TO "service_role";



GRANT ALL ON TABLE "public"."contract_types" TO "anon";
GRANT ALL ON TABLE "public"."contract_types" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_types" TO "service_role";



GRANT ALL ON TABLE "public"."contracts" TO "anon";
GRANT ALL ON TABLE "public"."contracts" TO "authenticated";
GRANT ALL ON TABLE "public"."contracts" TO "service_role";



GRANT ALL ON TABLE "public"."contracts_repository_view" TO "anon";
GRANT ALL ON TABLE "public"."contracts_repository_view" TO "authenticated";
GRANT ALL ON TABLE "public"."contracts_repository_view" TO "service_role";



GRANT ALL ON TABLE "public"."department_legal_assignments" TO "anon";
GRANT ALL ON TABLE "public"."department_legal_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."department_legal_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON TABLE "public"."holidays" TO "anon";
GRANT ALL ON TABLE "public"."holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."holidays" TO "service_role";



GRANT ALL ON TABLE "public"."idempotency_keys" TO "anon";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "service_role";



GRANT ALL ON TABLE "public"."master_counterparties" TO "anon";
GRANT ALL ON TABLE "public"."master_counterparties" TO "authenticated";
GRANT ALL ON TABLE "public"."master_counterparties" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."team_role_mappings" TO "anon";
GRANT ALL ON TABLE "public"."team_role_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."team_role_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."zoho_sign_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."zoho_sign_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."zoho_sign_webhook_events" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


