-- Persist counterparty metadata and supporting contract documents.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS counterparty_name TEXT;

CREATE TABLE IF NOT EXISTS public.contract_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  document_kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  file_mime_type TEXT NOT NULL,
  uploaded_by_employee_id TEXT NOT NULL,
  uploaded_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT contract_documents_kind_check CHECK (document_kind IN ('PRIMARY', 'COUNTERPARTY_SUPPORTING'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_documents_one_primary_per_contract
  ON public.contract_documents (tenant_id, contract_id, document_kind)
  WHERE deleted_at IS NULL AND document_kind = 'PRIMARY';

CREATE INDEX IF NOT EXISTS idx_contract_documents_tenant_contract_created
  ON public.contract_documents (tenant_id, contract_id, created_at DESC)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE event_object_table = 'contract_documents'
      AND trigger_name = 'update_contract_documents_updated_at'
  ) THEN
    CREATE TRIGGER update_contract_documents_updated_at
      BEFORE UPDATE ON public.contract_documents
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.contract_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contract_documents_tenant_isolation"
  ON public.contract_documents
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Backfill existing primary files as document records.
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
  created_at,
  updated_at
)
SELECT
  c.tenant_id,
  c.id,
  'PRIMARY',
  'Primary Contract',
  c.file_name,
  c.file_path,
  c.file_size_bytes,
  c.file_mime_type,
  c.uploaded_by_employee_id,
  c.uploaded_by_email,
  c.created_at,
  c.updated_at
FROM public.contracts c
WHERE c.deleted_at IS NULL
  AND c.file_path IS NOT NULL
  AND c.file_name IS NOT NULL
  AND c.file_size_bytes IS NOT NULL
  AND c.file_mime_type IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.contract_documents d
    WHERE d.tenant_id = c.tenant_id
      AND d.contract_id = c.id
      AND d.document_kind = 'PRIMARY'
      AND d.deleted_at IS NULL
  );
