CREATE TABLE IF NOT EXISTS public.contract_repository_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  user_id UUID,
  user_email TEXT NOT NULL,
  assignment_role TEXT NOT NULL CHECK (assignment_role IN ('OWNER', 'COLLABORATOR', 'APPROVER')),
  source TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (source IN ('SYSTEM', 'MANUAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT contract_repository_assignments_user_email_non_empty CHECK (btrim(user_email) <> '')
);

CREATE INDEX IF NOT EXISTS idx_contract_repository_assignments_tenant_contract
  ON public.contract_repository_assignments (tenant_id, contract_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_repository_assignments_tenant_user
  ON public.contract_repository_assignments (tenant_id, user_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_repository_assignments_unique_active
  ON public.contract_repository_assignments (tenant_id, contract_id, user_email, assignment_role)
  WHERE deleted_at IS NULL;

ALTER TABLE public.contract_repository_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_repository_assignments'
      AND policyname = 'contract_repository_assignments_service_role_all'
  ) THEN
    CREATE POLICY contract_repository_assignments_service_role_all
      ON public.contract_repository_assignments
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_repository_assignments'
      AND policyname = 'contract_repository_assignments_tenant_select'
  ) THEN
    CREATE POLICY contract_repository_assignments_tenant_select
      ON public.contract_repository_assignments
      FOR SELECT
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
  END IF;
END $$;

INSERT INTO public.contract_repository_assignments (
  tenant_id,
  contract_id,
  user_id,
  user_email,
  assignment_role,
  source
)
SELECT
  c.tenant_id,
  c.id,
  CASE
    WHEN c.current_assignee_employee_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN c.current_assignee_employee_id::UUID
    ELSE NULL
  END,
  LOWER(c.current_assignee_email),
  'OWNER',
  'SYSTEM'
FROM public.contracts c
WHERE c.deleted_at IS NULL
  AND c.current_assignee_email IS NOT NULL
  AND btrim(c.current_assignee_email) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.contract_repository_assignments (
  tenant_id,
  contract_id,
  user_id,
  user_email,
  assignment_role,
  source
)
SELECT
  l.tenant_id,
  l.contract_id,
  CASE
    WHEN l.collaborator_employee_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN l.collaborator_employee_id::UUID
    ELSE NULL
  END,
  LOWER(l.collaborator_email),
  'COLLABORATOR',
  'SYSTEM'
FROM public.contract_legal_collaborators l
WHERE l.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.contract_repository_assignments (
  tenant_id,
  contract_id,
  user_id,
  user_email,
  assignment_role,
  source
)
SELECT
  a.tenant_id,
  a.contract_id,
  CASE
    WHEN a.approver_employee_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN a.approver_employee_id::UUID
    ELSE NULL
  END,
  LOWER(a.approver_email),
  'APPROVER',
  'SYSTEM'
FROM public.contract_additional_approvers a
WHERE a.deleted_at IS NULL
ON CONFLICT DO NOTHING;
