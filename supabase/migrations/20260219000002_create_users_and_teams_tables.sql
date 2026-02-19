-- Create teams and users tables for email-based authentication and team-scoped routing

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  poc_email TEXT,
  hod_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT teams_name_unique UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  password_hash TEXT,
  role TEXT NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT users_email_unique UNIQUE (tenant_id, email),
  CONSTRAINT users_role_check CHECK (role IN ('POC', 'HOD', 'LEGAL_TEAM', 'ADMIN')),
  CONSTRAINT users_email_domain_check CHECK (email LIKE '%@nxtwave.co.in')
);

CREATE INDEX IF NOT EXISTS idx_teams_tenant_name ON teams(tenant_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON users(tenant_id, role) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_tenant_team ON users(tenant_id, team_id) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'teams'
    AND trigger_name = 'update_teams_updated_at'
  ) THEN
    CREATE TRIGGER update_teams_updated_at
      BEFORE UPDATE ON teams
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'users'
    AND trigger_name = 'update_users_updated_at'
  ) THEN
    CREATE TRIGGER update_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_tenant_isolation" ON teams
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY "users_tenant_isolation" ON users
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Compatibility backfill: migrate active @nxtwave.co.in employees into users if present
INSERT INTO users (tenant_id, email, full_name, password_hash, role, is_active, deleted_at)
SELECT
  e.tenant_id,
  e.email,
  e.full_name,
  e.password_hash,
  CASE
    WHEN UPPER(e.role) IN ('POC', 'HOD', 'LEGAL_TEAM', 'ADMIN') THEN UPPER(e.role)
    ELSE 'POC'
  END,
  e.is_active,
  e.deleted_at
FROM employees e
WHERE e.email IS NOT NULL
  AND e.email LIKE '%@nxtwave.co.in'
ON CONFLICT (tenant_id, email) DO NOTHING;
