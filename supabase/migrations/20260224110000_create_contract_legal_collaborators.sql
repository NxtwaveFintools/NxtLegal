-- Contract-level legal collaborators for internal legal work sharing

CREATE TABLE IF NOT EXISTS public.contract_legal_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  collaborator_employee_id TEXT NOT NULL,
  collaborator_email TEXT NOT NULL,
  created_by_employee_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT contract_legal_collaborators_email_lowercase_check CHECK (collaborator_email = lower(collaborator_email))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_legal_collaborators_unique_active
  ON public.contract_legal_collaborators (tenant_id, contract_id, collaborator_employee_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_legal_collaborators_contract_lookup
  ON public.contract_legal_collaborators (tenant_id, contract_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_legal_collaborators_employee_lookup
  ON public.contract_legal_collaborators (tenant_id, collaborator_employee_id)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'contract_legal_collaborators'
      AND trigger_name = 'update_contract_legal_collaborators_updated_at'
  ) THEN
    CREATE TRIGGER update_contract_legal_collaborators_updated_at
      BEFORE UPDATE ON public.contract_legal_collaborators
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.contract_legal_collaborators ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_legal_collaborators'
      AND policyname = 'contract_legal_collaborators_tenant_isolation'
  ) THEN
    CREATE POLICY "contract_legal_collaborators_tenant_isolation" ON public.contract_legal_collaborators
      FOR ALL
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
      WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
  END IF;
END $$;
