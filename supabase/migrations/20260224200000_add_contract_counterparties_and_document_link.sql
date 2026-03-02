-- Add normalized contract counterparties and link supporting documents per counterparty.

CREATE TABLE IF NOT EXISTS public.contract_counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  counterparty_name TEXT NOT NULL,
  sequence_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT contract_counterparties_name_not_empty CHECK (char_length(trim(counterparty_name)) > 0),
  CONSTRAINT contract_counterparties_sequence_positive CHECK (sequence_order > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_counterparties_unique_sequence
  ON public.contract_counterparties (tenant_id, contract_id, sequence_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_counterparties_contract
  ON public.contract_counterparties (tenant_id, contract_id, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_counterparties_tenant_id_id
  ON public.contract_counterparties (tenant_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE event_object_table = 'contract_counterparties'
      AND trigger_name = 'update_contract_counterparties_updated_at'
  ) THEN
    CREATE TRIGGER update_contract_counterparties_updated_at
      BEFORE UPDATE ON public.contract_counterparties
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.contract_counterparties ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_counterparties'
      AND policyname = 'contract_counterparties_tenant_isolation'
  ) THEN
    CREATE POLICY "contract_counterparties_tenant_isolation"
      ON public.contract_counterparties
      FOR ALL
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
      WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
  END IF;
END $$;

ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS counterparty_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_documents_counterparty_tenant_fkey'
  ) THEN
    ALTER TABLE public.contract_documents
      ADD CONSTRAINT contract_documents_counterparty_tenant_fkey
      FOREIGN KEY (tenant_id, counterparty_id)
      REFERENCES public.contract_counterparties(tenant_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_documents_counterparty_id
  ON public.contract_documents (counterparty_id)
  WHERE deleted_at IS NULL;

-- Backfill legacy single-counterparty records.
INSERT INTO public.contract_counterparties (tenant_id, contract_id, counterparty_name, sequence_order, created_at, updated_at)
SELECT
  c.tenant_id,
  c.id,
  trim(c.counterparty_name),
  1,
  c.created_at,
  c.updated_at
FROM public.contracts c
WHERE c.deleted_at IS NULL
  AND c.counterparty_name IS NOT NULL
  AND char_length(trim(c.counterparty_name)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.contract_counterparties cc
    WHERE cc.tenant_id = c.tenant_id
      AND cc.contract_id = c.id
      AND cc.sequence_order = 1
      AND cc.deleted_at IS NULL
  );

UPDATE public.contract_documents d
SET counterparty_id = cc.id
FROM public.contract_counterparties cc
WHERE d.tenant_id = cc.tenant_id
  AND d.contract_id = cc.contract_id
  AND d.document_kind = 'COUNTERPARTY_SUPPORTING'
  AND d.deleted_at IS NULL
  AND cc.sequence_order = 1
  AND cc.deleted_at IS NULL
  AND d.counterparty_id IS NULL;