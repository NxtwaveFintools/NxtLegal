-- Create sequential additional approvers table and add HOD bypass transition policy

CREATE TABLE IF NOT EXISTS contract_additional_approvers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  approver_employee_id TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  sequence_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_at TIMESTAMPTZ,
  created_by_employee_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT contract_additional_approvers_status_check CHECK (status IN ('PENDING', 'APPROVED')),
  CONSTRAINT contract_additional_approvers_sequence_unique UNIQUE (tenant_id, contract_id, sequence_order)
);

CREATE INDEX IF NOT EXISTS idx_contract_additional_approvers_lookup
  ON contract_additional_approvers(tenant_id, contract_id, status, sequence_order)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'contract_additional_approvers'
    AND trigger_name = 'update_contract_additional_approvers_updated_at'
  ) THEN
    CREATE TRIGGER update_contract_additional_approvers_updated_at
      BEFORE UPDATE ON contract_additional_approvers
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE contract_additional_approvers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_additional_approvers'
      AND policyname = 'contract_additional_approvers_tenant_isolation'
  ) THEN
    CREATE POLICY "contract_additional_approvers_tenant_isolation" ON contract_additional_approvers
      FOR ALL
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
      WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
  END IF;
END $$;

INSERT INTO contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::UUID, 'HOD_PENDING', 'LEGAL_PENDING', 'hod.bypass', ARRAY['HOD','ADMIN'], TRUE)
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();