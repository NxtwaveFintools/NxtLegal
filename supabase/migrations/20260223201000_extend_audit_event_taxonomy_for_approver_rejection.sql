-- Ensure audit event taxonomy supports additional approver rejection events

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_event_type') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = 'audit_event_type'::regtype
        AND enumlabel = 'CONTRACT_APPROVER_REJECTED'
    ) THEN
      ALTER TYPE audit_event_type ADD VALUE 'CONTRACT_APPROVER_REJECTED';
    END IF;
  END IF;
END $$;
