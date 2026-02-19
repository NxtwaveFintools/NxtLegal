-- Add enum-backed audit event taxonomy and actor metadata fields for contract workflow observability

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_event_type') THEN
    CREATE TYPE audit_event_type AS ENUM (
      'CONTRACT_CREATED',
      'CONTRACT_TRANSITIONED',
      'CONTRACT_APPROVED',
      'CONTRACT_BYPASSED',
      'CONTRACT_NOTE_ADDED',
      'CONTRACT_APPROVER_ADDED',
      'CONTRACT_APPROVER_APPROVED'
    );
  END IF;
END $$;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS event_type audit_event_type,
  ADD COLUMN IF NOT EXISTS actor_email TEXT,
  ADD COLUMN IF NOT EXISTS actor_role TEXT;

UPDATE audit_logs
SET event_type = CASE
  WHEN action = 'contract.created' THEN 'CONTRACT_CREATED'::audit_event_type
  WHEN action IN ('contract.legal.query', 'contract.legal.query.reroute') THEN 'CONTRACT_TRANSITIONED'::audit_event_type
  WHEN action IN ('contract.hod.approve', 'contract.legal.approve') THEN 'CONTRACT_APPROVED'::audit_event_type
  WHEN action = 'contract.hod.bypass' THEN 'CONTRACT_BYPASSED'::audit_event_type
  WHEN action = 'contract.note.added' THEN 'CONTRACT_NOTE_ADDED'::audit_event_type
  WHEN action = 'contract.approver.added' THEN 'CONTRACT_APPROVER_ADDED'::audit_event_type
  WHEN action = 'contract.approver.approved' THEN 'CONTRACT_APPROVER_APPROVED'::audit_event_type
  ELSE 'CONTRACT_TRANSITIONED'::audit_event_type
END
WHERE event_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_contract_event_type
  ON audit_logs(tenant_id, resource_type, resource_id, event_type, event_sequence DESC);