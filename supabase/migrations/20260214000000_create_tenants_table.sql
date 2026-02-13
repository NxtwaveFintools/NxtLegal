-- Up Migration: Create tenants table
-- 2026-02-14 00:00:00

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'us-east-1',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Enable RLS on tenants (admins only)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Index for lookups
CREATE INDEX idx_tenants_deleted_at ON tenants(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_tenants_region ON tenants(region);
