-- Security + performance hardening for remaining advisor findings.

ALTER FUNCTION public.validate_contract_current_document() SET search_path = public;
ALTER FUNCTION public.sync_contract_current_document_from_primary_insert() SET search_path = public;
ALTER FUNCTION public.business_day_diff(date, date) SET search_path = public;
ALTER FUNCTION public.business_day_add(date, integer) SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.ensure_audit_immutable() SET search_path = public;

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'holidays'
      AND policyname = 'holidays_select_authenticated'
  ) THEN
    CREATE POLICY holidays_select_authenticated
      ON public.holidays
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

ALTER TABLE public.contracts
ADD COLUMN IF NOT EXISTS void_reason text;

UPDATE public.contracts AS c
SET void_reason = al.note_text
FROM (
  SELECT DISTINCT ON (resource_id)
    tenant_id,
    resource_id,
    note_text
  FROM public.audit_logs
  WHERE resource_type = 'contract'
    AND action = 'contract.legal.void'
    AND note_text IS NOT NULL
    AND btrim(note_text) <> ''
  ORDER BY resource_id, created_at DESC
) AS al
WHERE c.id::text = al.resource_id
  AND c.tenant_id = al.tenant_id
  AND c.void_reason IS NULL;

CREATE OR REPLACE VIEW public.contracts_repository_view
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.tenant_id,
  c.title,
  c.status,
  c.uploaded_by_employee_id,
  c.uploaded_by_email,
  c.current_assignee_employee_id,
  c.current_assignee_email,
  c.hod_approved_at,
  c.tat_deadline_at,
  c.tat_breached_at,
  c.created_at,
  c.updated_at,
  CASE
    WHEN c.hod_approved_at IS NULL THEN NULL::integer
    ELSE public.business_day_diff(
      (c.hod_approved_at AT TIME ZONE 'UTC')::date,
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
    )
  END AS aging_business_days,
  CASE
    WHEN c.tat_deadline_at IS NOT NULL
      AND CURRENT_TIMESTAMP > c.tat_deadline_at
      AND c.status <> ALL (ARRAY['COMPLETED'::text, 'EXECUTED'::text, 'REJECTED'::text])
    THEN true
    ELSE false
  END AS is_tat_breached,
  CASE
    WHEN c.tat_deadline_at IS NOT NULL
      AND CURRENT_TIMESTAMP <= c.tat_deadline_at
      AND c.status <> ALL (ARRAY['COMPLETED'::text, 'EXECUTED'::text, 'REJECTED'::text])
      AND public.business_day_diff(
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
        (c.tat_deadline_at AT TIME ZONE 'UTC')::date
      ) = 1
    THEN true
    ELSE false
  END AS near_breach,
  c.department_id,
  c.request_created_at,
  c.void_reason
FROM public.contracts AS c
WHERE c.deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_documents_contract_id
ON public.contract_documents (contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_legal_collaborators_tenant_id
ON public.contract_legal_collaborators (tenant_id);

CREATE INDEX IF NOT EXISTS idx_contract_repository_assignments_tenant_id
ON public.contract_repository_assignments (tenant_id);

CREATE INDEX IF NOT EXISTS idx_contract_signatories_tenant_id
ON public.contract_signatories (tenant_id);

CREATE INDEX IF NOT EXISTS idx_contracts_tenant_id_contract_type_id
ON public.contracts (tenant_id, contract_type_id);

CREATE INDEX IF NOT EXISTS idx_contracts_current_document_id
ON public.contracts (current_document_id);

CREATE INDEX IF NOT EXISTS idx_department_legal_assignments_assigned_by
ON public.department_legal_assignments (assigned_by);

CREATE INDEX IF NOT EXISTS idx_department_legal_assignments_department_id
ON public.department_legal_assignments (department_id);

CREATE INDEX IF NOT EXISTS idx_department_legal_assignments_revoked_by
ON public.department_legal_assignments (revoked_by);

CREATE INDEX IF NOT EXISTS idx_department_legal_assignments_user_id
ON public.department_legal_assignments (user_id);

CREATE INDEX IF NOT EXISTS idx_department_role_map_created_by
ON public.department_role_map (created_by);

CREATE INDEX IF NOT EXISTS idx_department_role_map_department_id
ON public.department_role_map (department_id);

CREATE INDEX IF NOT EXISTS idx_department_role_map_role_id
ON public.department_role_map (role_id);

CREATE INDEX IF NOT EXISTS idx_department_role_map_tenant_id
ON public.department_role_map (tenant_id);

CREATE INDEX IF NOT EXISTS idx_department_role_map_user_id
ON public.department_role_map (user_id);

CREATE INDEX IF NOT EXISTS idx_docusign_webhook_events_contract_id
ON public.docusign_webhook_events (contract_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_created_by
ON public.role_permissions (created_by);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id
ON public.role_permissions (permission_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id
ON public.role_permissions (role_id);

CREATE INDEX IF NOT EXISTS idx_roles_created_by
ON public.roles (created_by);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id
ON public.team_members (team_id);

CREATE INDEX IF NOT EXISTS idx_team_members_user_id
ON public.team_members (user_id);

CREATE INDEX IF NOT EXISTS idx_team_role_mappings_assigned_by
ON public.team_role_mappings (assigned_by);

CREATE INDEX IF NOT EXISTS idx_team_role_mappings_replaced_by
ON public.team_role_mappings (replaced_by);

CREATE INDEX IF NOT EXISTS idx_team_role_mappings_team_id
ON public.team_role_mappings (team_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_assigned_by
ON public.user_roles (assigned_by);

CREATE INDEX IF NOT EXISTS idx_user_roles_revoked_by
ON public.user_roles (revoked_by);

CREATE INDEX IF NOT EXISTS idx_user_roles_role_id
ON public.user_roles (role_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_tenant_id
ON public.user_roles (tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
ON public.user_roles (user_id);