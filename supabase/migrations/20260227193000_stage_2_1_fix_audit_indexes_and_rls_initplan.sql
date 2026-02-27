BEGIN;

DROP INDEX IF EXISTS public.idx_audit_logs_resource_id_trgm;
DROP INDEX IF EXISTS public.idx_audit_logs_user_id_trgm;

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created_desc
  ON public.audit_logs USING btree (user_id, created_at DESC);

DROP POLICY IF EXISTS audit_logs_tenant_isolation ON public.audit_logs;
CREATE POLICY audit_logs_tenant_isolation
  ON public.audit_logs
  FOR ALL
  TO public
  USING (tenant_id = (((SELECT auth.jwt()) ->> 'tenant_id'::text))::uuid)
  WITH CHECK (tenant_id = (((SELECT auth.jwt()) ->> 'tenant_id'::text))::uuid);

DROP POLICY IF EXISTS contracts_tenant_isolation ON public.contracts;
CREATE POLICY contracts_tenant_isolation
  ON public.contracts
  FOR ALL
  TO public
  USING (tenant_id = (((SELECT auth.jwt()) ->> 'tenant_id'::text))::uuid)
  WITH CHECK (tenant_id = (((SELECT auth.jwt()) ->> 'tenant_id'::text))::uuid);

DROP POLICY IF EXISTS employees_tenant_isolation ON public.employees;
CREATE POLICY employees_tenant_isolation
  ON public.employees
  FOR ALL
  TO public
  USING (tenant_id = (((SELECT auth.jwt()) ->> 'tenant_id'::text))::uuid)
  WITH CHECK (tenant_id = (((SELECT auth.jwt()) ->> 'tenant_id'::text))::uuid);

COMMIT;
