-- Track per-user contract activity read state and extend activity taxonomy for discussion entries

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_event_type') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = 'audit_event_type'::regtype
        AND enumlabel = 'CONTRACT_ACTIVITY_MESSAGE_ADDED'
    ) THEN
      ALTER TYPE audit_event_type ADD VALUE 'CONTRACT_ACTIVITY_MESSAGE_ADDED';
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.contract_activity_read_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  last_seen_event_sequence BIGINT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contract_activity_read_state_unique UNIQUE (tenant_id, contract_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_activity_read_state_contract
  ON public.contract_activity_read_state (tenant_id, contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_activity_read_state_employee
  ON public.contract_activity_read_state (tenant_id, employee_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'contract_activity_read_state'
      AND trigger_name = 'update_contract_activity_read_state_updated_at'
  ) THEN
    CREATE TRIGGER update_contract_activity_read_state_updated_at
      BEFORE UPDATE ON public.contract_activity_read_state
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.contract_activity_read_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_activity_read_state'
      AND policyname = 'contract_activity_read_state_tenant_isolation'
  ) THEN
    CREATE POLICY "contract_activity_read_state_tenant_isolation" ON public.contract_activity_read_state
      FOR ALL
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
      WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
  END IF;
END $$;
