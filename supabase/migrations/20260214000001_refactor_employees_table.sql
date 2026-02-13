-- Up Migration: Refactor employees table for multi-tenant support
-- Adds tenant_id (required), deleted_at (soft delete), and role field
-- 2026-02-14 00:01:00

-- First, add new columns
ALTER TABLE employees ADD COLUMN tenant_id UUID;
ALTER TABLE employees ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN role TEXT DEFAULT 'viewer';

-- Add UUID id column (keeping employee_id for backward compatibility)
ALTER TABLE employees ADD COLUMN id UUID DEFAULT gen_random_uuid();

-- Create a temporary default tenant for existing data
INSERT INTO tenants (id, name, region)
VALUES ('00000000-0000-0000-0000-000000000000'::UUID, 'DEFAULT_TENANT', 'us-east-1')
ON CONFLICT DO NOTHING;

-- Update existing employees to have tenant_id set to default tenant
UPDATE employees 
SET tenant_id = '00000000-0000-0000-0000-000000000000'::UUID 
WHERE tenant_id IS NULL;

-- Make tenant_id NOT NULL and add foreign key
ALTER TABLE employees 
  ALTER COLUMN tenant_id SET NOT NULL,
  ADD CONSTRAINT employees_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- Create proper indexes
CREATE INDEX idx_employees_id ON employees(id);
CREATE INDEX idx_employees_tenant_id ON employees(tenant_id);
CREATE INDEX idx_employees_email_tenant ON employees(email, tenant_id);
CREATE INDEX idx_employees_deleted_at ON employees(deleted_at) WHERE deleted_at IS NULL;

-- Enable RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Employees can only see their own tenant's employees
CREATE POLICY "employees_tenant_isolation" ON employees
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Trigger already created in initial migration, skip recreation
