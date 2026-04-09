WITH tenant_scope AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS tenant_id
  UNION
  SELECT DISTINCT tenant_id
  FROM public.contract_transition_graph
)
INSERT INTO public.contract_transition_graph (
  tenant_id,
  from_status,
  to_status,
  trigger_action,
  allowed_roles,
  is_active
)
SELECT
  tenant_scope.tenant_id,
  'HOD_PENDING',
  'VOID',
  'legal.void',
  ARRAY['LEGAL_TEAM', 'ADMIN', 'POC'],
  TRUE
FROM tenant_scope
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET
  allowed_roles = EXCLUDED.allowed_roles,
  is_active = TRUE,
  updated_at = NOW();
