-- Migration: add_contract_date_basis_indexes
-- Adds composite indexes on the two dateBasis columns used by the repository
-- report and list queries, eliminating sequential scans on large tenant datasets.
-- Previously these columns had no tenant-scoped indexes, causing 1.4-1.6 s
-- query times for collectRepositoryContractsForReporting.

-- Index for date-range filtering when dateBasis = 'request_created_at' (default).
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_request_created_at
  ON public.contracts (tenant_id, request_created_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- Index for date-range filtering when dateBasis = 'hod_approved_at'.
-- Partial index excludes NULL rows to minimise index size.
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_hod_approved_at
  ON public.contracts (tenant_id, hod_approved_at DESC NULLS LAST)
  WHERE deleted_at IS NULL AND hod_approved_at IS NOT NULL;

-- Composite covering index for the common tenant + status + created_at sort
-- used when no date filter is active in the repository list/report path.
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_status_created_at
  ON public.contracts (tenant_id, status, created_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;
