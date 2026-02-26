-- Enable LEGAL_TEAM membership mappings while preserving one active POC/HOD per department

ALTER TABLE public.team_role_mappings
  DROP CONSTRAINT IF EXISTS team_role_mappings_role_type_check;

ALTER TABLE public.team_role_mappings
  ADD CONSTRAINT team_role_mappings_role_type_check
  CHECK (role_type IN ('POC', 'HOD', 'LEGAL_TEAM'));

DROP INDEX IF EXISTS public.idx_team_role_mappings_active_role_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_role_mappings_active_primary_role_unique
  ON public.team_role_mappings (tenant_id, team_id, role_type)
  WHERE active_flag = TRUE AND deleted_at IS NULL AND role_type IN ('POC', 'HOD');

CREATE INDEX IF NOT EXISTS idx_team_role_mappings_legal_lookup
  ON public.team_role_mappings (tenant_id, lower(email), role_type)
  WHERE active_flag = TRUE AND deleted_at IS NULL;
