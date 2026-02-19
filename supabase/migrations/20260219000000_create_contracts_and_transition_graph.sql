-- Create contracts table and configurable transition graph for enterprise workflow

CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  uploaded_by_employee_id TEXT NOT NULL,
  uploaded_by_email TEXT NOT NULL,
  current_assignee_employee_id TEXT NOT NULL,
  current_assignee_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'HOD_PENDING',
  row_version INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hod_approved_at TIMESTAMPTZ,
  legal_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT contracts_status_check CHECK (
    status IN (
      'UPLOADED',
      'HOD_PENDING',
      'HOD_APPROVED',
      'LEGAL_PENDING',
      'LEGAL_QUERY',
      'FINAL_APPROVED'
    )
  )
);

CREATE TABLE IF NOT EXISTS contract_transition_graph (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  trigger_action TEXT NOT NULL,
  allowed_roles TEXT[] NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contract_transition_graph_status_check CHECK (
    from_status IN (
      'UPLOADED',
      'HOD_PENDING',
      'HOD_APPROVED',
      'LEGAL_PENDING',
      'LEGAL_QUERY',
      'FINAL_APPROVED'
    )
    AND to_status IN (
      'UPLOADED',
      'HOD_PENDING',
      'HOD_APPROVED',
      'LEGAL_PENDING',
      'LEGAL_QUERY',
      'FINAL_APPROVED'
    )
  ),
  CONSTRAINT contract_transition_graph_unique_edge UNIQUE (tenant_id, from_status, to_status, trigger_action)
);

CREATE INDEX IF NOT EXISTS idx_contracts_tenant_status ON contracts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_assignee ON contracts(tenant_id, current_assignee_employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_created_at ON contracts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_transition_graph_tenant ON contract_transition_graph(tenant_id, is_active);

-- Keep timestamp fresh on updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'contracts'
    AND trigger_name = 'update_contracts_updated_at'
  ) THEN
    CREATE TRIGGER update_contracts_updated_at
      BEFORE UPDATE ON contracts
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'contract_transition_graph'
    AND trigger_name = 'update_contract_transition_graph_updated_at'
  ) THEN
    CREATE TRIGGER update_contract_transition_graph_updated_at
      BEFORE UPDATE ON contract_transition_graph
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_transition_graph ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contracts_tenant_isolation" ON contracts
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY "contract_transition_graph_tenant_isolation" ON contract_transition_graph
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

INSERT INTO contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles)
VALUES
  ('00000000-0000-0000-0000-000000000000'::UUID, 'UPLOADED', 'HOD_PENDING', 'system.route_to_hod', ARRAY['SYSTEM','ADMIN']),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'HOD_PENDING', 'HOD_APPROVED', 'hod.approve', ARRAY['HOD','ADMIN']),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'HOD_APPROVED', 'LEGAL_PENDING', 'system.route_to_legal', ARRAY['SYSTEM','ADMIN']),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'LEGAL_PENDING', 'FINAL_APPROVED', 'legal.approve', ARRAY['LEGAL_TEAM','ADMIN']),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'LEGAL_PENDING', 'LEGAL_QUERY', 'legal.query', ARRAY['LEGAL_TEAM','ADMIN']),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'LEGAL_QUERY', 'HOD_PENDING', 'legal.query.reroute', ARRAY['LEGAL_TEAM','ADMIN']),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'LEGAL_QUERY', 'LEGAL_QUERY', 'legal.query.reroute', ARRAY['LEGAL_TEAM','ADMIN'])
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO NOTHING;
