-- Create idempotency_keys table for duplicate prevention
CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  response_data JSONB NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(key, tenant_id)
);

-- Indexes for efficient querying
CREATE INDEX idx_idempotency_keys_tenant_id ON idempotency_keys(tenant_id);
CREATE INDEX idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);
CREATE INDEX idx_idempotency_keys_composite ON idempotency_keys(key, tenant_id);

-- RLS Policy for tenant isolation
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "idempotency_keys_tenant_isolation" ON idempotency_keys
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Note: Expired keys should be cleaned up by a scheduled background job
-- See: migrations history for cleanup job definitions
