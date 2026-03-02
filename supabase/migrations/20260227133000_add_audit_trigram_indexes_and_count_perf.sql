BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_trgm
  ON public.audit_logs
  USING gin (action gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type_trgm
  ON public.audit_logs
  USING gin (resource_type gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id_trgm
  ON public.audit_logs
  USING gin (resource_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id_trgm
  ON public.audit_logs
  USING gin (user_id gin_trgm_ops);

COMMIT;
