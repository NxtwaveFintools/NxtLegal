DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contract_signatories'
      AND column_name = 'docusign_envelope_id'
  ) THEN
    ALTER TABLE public.contract_signatories
      RENAME COLUMN docusign_envelope_id TO zoho_sign_envelope_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contract_signatories'
      AND column_name = 'docusign_recipient_id'
  ) THEN
    ALTER TABLE public.contract_signatories
      RENAME COLUMN docusign_recipient_id TO zoho_sign_recipient_id;
  END IF;
END $$;

ALTER INDEX IF EXISTS public.idx_contract_signatories_envelope_recipient_unique
  RENAME TO idx_contract_signatories_zoho_sign_envelope_recipient_unique;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'docusign_webhook_events'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'zoho_sign_webhook_events'
  ) THEN
    ALTER TABLE public.docusign_webhook_events
      RENAME TO zoho_sign_webhook_events;
  END IF;
END $$;

ALTER INDEX IF EXISTS public.idx_docusign_webhook_events_event_key
  RENAME TO idx_zoho_sign_webhook_events_event_key;

ALTER INDEX IF EXISTS public.idx_docusign_webhook_events_contract_created
  RENAME TO idx_zoho_sign_webhook_events_contract_created;

ALTER INDEX IF EXISTS public.idx_docusign_webhook_events_contract_id
  RENAME TO idx_zoho_sign_webhook_events_contract_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'docusign_webhook_events_contract_id_fkey'
      AND conrelid = 'public.zoho_sign_webhook_events'::regclass
  ) THEN
    ALTER TABLE public.zoho_sign_webhook_events
      RENAME CONSTRAINT docusign_webhook_events_contract_id_fkey TO zoho_sign_webhook_events_contract_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'docusign_webhook_events_tenant_id_fkey'
      AND conrelid = 'public.zoho_sign_webhook_events'::regclass
  ) THEN
    ALTER TABLE public.zoho_sign_webhook_events
      RENAME CONSTRAINT docusign_webhook_events_tenant_id_fkey TO zoho_sign_webhook_events_tenant_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'zoho_sign_webhook_events'
      AND policyname = 'docusign_webhook_events_tenant_isolation'
  ) THEN
    ALTER POLICY docusign_webhook_events_tenant_isolation
      ON public.zoho_sign_webhook_events
      RENAME TO zoho_sign_webhook_events_tenant_isolation;
  END IF;
END $$;
