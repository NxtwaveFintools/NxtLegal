-- Fix audit_logs user_id column type from UUID to TEXT
-- This migration changes user_id to TEXT to match employee_id usage

-- Drop the dependent trigger first
DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;

-- Alter the column type
ALTER TABLE audit_logs ALTER COLUMN user_id TYPE TEXT;

-- Recreate the immutability trigger
CREATE OR REPLACE FUNCTION ensure_audit_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP != 'INSERT' THEN
    RAISE EXCEPTION 'Audit logs are immutable - no updates or deletes allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION ensure_audit_immutable();
