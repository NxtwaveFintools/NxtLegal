-- Store reusable counterparty names scoped by tenant.

CREATE TABLE IF NOT EXISTS public.master_counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT master_counterparties_name_non_empty CHECK (char_length(trim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_counterparties_tenant_name_unique
  ON public.master_counterparties (tenant_id, name);

ALTER TABLE public.master_counterparties ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'master_counterparties'
      AND policyname = 'master_counterparties_tenant_isolation'
  ) THEN
    CREATE POLICY "master_counterparties_tenant_isolation"
      ON public.master_counterparties
      FOR ALL
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
      WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
  END IF;
END $$;
