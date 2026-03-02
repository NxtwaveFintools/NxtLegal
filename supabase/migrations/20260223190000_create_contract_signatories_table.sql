CREATE TABLE IF NOT EXISTS public.contract_signatories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  signatory_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  docusign_envelope_id TEXT NOT NULL,
  docusign_recipient_id TEXT NOT NULL,
  signed_at TIMESTAMPTZ,
  created_by_employee_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT contract_signatories_status_check CHECK (status IN ('PENDING', 'SIGNED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_signatories_envelope_unique
  ON public.contract_signatories (tenant_id, docusign_envelope_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_signatories_contract_status
  ON public.contract_signatories (tenant_id, contract_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE event_object_table = 'contract_signatories'
      AND trigger_name = 'update_contract_signatories_updated_at'
  ) THEN
    CREATE TRIGGER update_contract_signatories_updated_at
      BEFORE UPDATE ON public.contract_signatories
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.contract_signatories ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_signatories'
      AND policyname = 'contract_signatories_tenant_isolation'
  ) THEN
    CREATE POLICY "contract_signatories_tenant_isolation"
      ON public.contract_signatories
      FOR ALL
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
      WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
  END IF;
END $$;