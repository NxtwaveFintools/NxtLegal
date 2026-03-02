-- Hardening: ensure repository view executes with caller permissions and
-- add covering indexes for contract foreign keys flagged by database advisors.

ALTER VIEW public.contracts_repository_view
SET (security_invoker = true);

CREATE INDEX IF NOT EXISTS idx_contract_activity_read_state_contract_id
ON public.contract_activity_read_state (contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_additional_approvers_contract_id
ON public.contract_additional_approvers (contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_counterparties_contract_id
ON public.contract_counterparties (contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_documents_tenant_id_counterparty_id
ON public.contract_documents (tenant_id, counterparty_id);

CREATE INDEX IF NOT EXISTS idx_contract_documents_replaced_document_id
ON public.contract_documents (replaced_document_id);

CREATE INDEX IF NOT EXISTS idx_contract_legal_collaborators_contract_id
ON public.contract_legal_collaborators (contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_notification_deliveries_contract_id
ON public.contract_notification_deliveries (contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_repository_assignments_contract_id
ON public.contract_repository_assignments (contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_signatories_contract_id
ON public.contract_signatories (contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_signatories_envelope_source_document_id
ON public.contract_signatories (envelope_source_document_id);

CREATE INDEX IF NOT EXISTS idx_contract_signing_preparation_drafts_contract_id
ON public.contract_signing_preparation_drafts (contract_id);