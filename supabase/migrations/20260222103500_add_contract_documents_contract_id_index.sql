-- Add covering index for contract_documents.contract_id foreign key.

CREATE INDEX IF NOT EXISTS idx_contract_documents_contract_id
  ON public.contract_documents (contract_id)
  WHERE deleted_at IS NULL;
