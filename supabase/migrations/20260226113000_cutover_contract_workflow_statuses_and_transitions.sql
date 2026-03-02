DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'contracts'
      AND constraint_name = 'contracts_status_check'
  ) THEN
    ALTER TABLE public.contracts
      DROP CONSTRAINT contracts_status_check;
  END IF;
END $$;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'DRAFT'::text,
        'UPLOADED'::text,
        'HOD_PENDING'::text,
        'UNDER_REVIEW'::text,
        'PENDING_WITH_INTERNAL_STAKEHOLDERS'::text,
        'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::text,
        'OFFLINE_EXECUTION'::text,
        'ON_HOLD'::text,
        'COMPLETED'::text,
        'EXECUTED'::text,
        'VOID'::text,
        'REJECTED'::text,
        'HOD_APPROVED'::text,
        'LEGAL_PENDING'::text,
        'LEGAL_QUERY'::text,
        'FINAL_APPROVED'::text,
        'IN_SIGNATURE'::text
      ]
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_transition_graph_status_check'
      AND conrelid = 'public.contract_transition_graph'::regclass
  ) THEN
    ALTER TABLE public.contract_transition_graph DROP CONSTRAINT contract_transition_graph_status_check;
  END IF;
END $$;

ALTER TABLE public.contract_transition_graph
  ADD CONSTRAINT contract_transition_graph_status_check CHECK (
    from_status IN (
      'DRAFT',
      'UPLOADED',
      'HOD_PENDING',
      'UNDER_REVIEW',
      'PENDING_WITH_INTERNAL_STAKEHOLDERS',
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS',
      'OFFLINE_EXECUTION',
      'ON_HOLD',
      'COMPLETED',
      'EXECUTED',
      'VOID',
      'REJECTED',
      'HOD_APPROVED',
      'LEGAL_PENDING',
      'LEGAL_QUERY',
      'FINAL_APPROVED',
      'IN_SIGNATURE'
    )
    AND to_status IN (
      'DRAFT',
      'UPLOADED',
      'HOD_PENDING',
      'UNDER_REVIEW',
      'PENDING_WITH_INTERNAL_STAKEHOLDERS',
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS',
      'OFFLINE_EXECUTION',
      'ON_HOLD',
      'COMPLETED',
      'EXECUTED',
      'VOID',
      'REJECTED',
      'HOD_APPROVED',
      'LEGAL_PENDING',
      'LEGAL_QUERY',
      'FINAL_APPROVED',
      'IN_SIGNATURE'
    )
  );

UPDATE public.contracts
SET status = CASE status
  WHEN 'LEGAL_PENDING' THEN 'UNDER_REVIEW'
  WHEN 'LEGAL_QUERY' THEN 'ON_HOLD'
  WHEN 'FINAL_APPROVED' THEN 'COMPLETED'
  WHEN 'IN_SIGNATURE' THEN 'PENDING_WITH_EXTERNAL_STAKEHOLDERS'
  WHEN 'HOD_APPROVED' THEN 'UNDER_REVIEW'
  ELSE status
END
WHERE status IN ('LEGAL_PENDING', 'LEGAL_QUERY', 'FINAL_APPROVED', 'IN_SIGNATURE', 'HOD_APPROVED');

UPDATE public.contract_transition_graph
SET from_status = CASE from_status
  WHEN 'LEGAL_PENDING' THEN 'UNDER_REVIEW'
  WHEN 'LEGAL_QUERY' THEN 'ON_HOLD'
  WHEN 'FINAL_APPROVED' THEN 'COMPLETED'
  WHEN 'IN_SIGNATURE' THEN 'PENDING_WITH_EXTERNAL_STAKEHOLDERS'
  WHEN 'HOD_APPROVED' THEN 'UNDER_REVIEW'
  ELSE from_status
END,
    to_status = CASE to_status
  WHEN 'LEGAL_PENDING' THEN 'UNDER_REVIEW'
  WHEN 'LEGAL_QUERY' THEN 'ON_HOLD'
  WHEN 'FINAL_APPROVED' THEN 'COMPLETED'
  WHEN 'IN_SIGNATURE' THEN 'PENDING_WITH_EXTERNAL_STAKEHOLDERS'
  WHEN 'HOD_APPROVED' THEN 'UNDER_REVIEW'
  ELSE to_status
END,
    updated_at = NOW()
WHERE from_status IN ('LEGAL_PENDING', 'LEGAL_QUERY', 'FINAL_APPROVED', 'IN_SIGNATURE', 'HOD_APPROVED')
   OR to_status IN ('LEGAL_PENDING', 'LEGAL_QUERY', 'FINAL_APPROVED', 'IN_SIGNATURE', 'HOD_APPROVED');

UPDATE public.contract_transition_graph
SET is_active = FALSE,
    updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000000'::UUID;

INSERT INTO public.contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::UUID, 'DRAFT', 'HOD_PENDING', 'system.route_to_hod', ARRAY['SYSTEM', 'ADMIN'], TRUE),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'UPLOADED', 'HOD_PENDING', 'system.route_to_hod', ARRAY['SYSTEM', 'ADMIN'], TRUE),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'HOD_PENDING', 'UNDER_REVIEW', 'hod.approve', ARRAY['HOD', 'ADMIN'], TRUE),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'HOD_PENDING', 'UNDER_REVIEW', 'hod.bypass', ARRAY['LEGAL_TEAM', 'ADMIN'], TRUE),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'HOD_PENDING', 'REJECTED', 'hod.reject', ARRAY['HOD', 'ADMIN'], TRUE),
  ('00000000-0000-0000-0000-000000000000'::UUID, 'UNDER_REVIEW', 'HOD_PENDING', 'legal.query.reroute', ARRAY['LEGAL_TEAM', 'ADMIN'], TRUE)
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO public.contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  s.status,
  'UNDER_REVIEW',
  'legal.set.under_review',
  ARRAY['LEGAL_TEAM', 'ADMIN'],
  TRUE
FROM (
  SELECT unnest(
    ARRAY[
      'UNDER_REVIEW'::text,
      'PENDING_WITH_INTERNAL_STAKEHOLDERS'::text,
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::text,
      'OFFLINE_EXECUTION'::text,
      'ON_HOLD'::text,
      'COMPLETED'::text
    ]
  ) AS status
) s
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO public.contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  s.status,
  'PENDING_WITH_INTERNAL_STAKEHOLDERS',
  'legal.set.pending_internal',
  ARRAY['LEGAL_TEAM', 'ADMIN'],
  TRUE
FROM (
  SELECT unnest(
    ARRAY[
      'UNDER_REVIEW'::text,
      'PENDING_WITH_INTERNAL_STAKEHOLDERS'::text,
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::text,
      'OFFLINE_EXECUTION'::text,
      'ON_HOLD'::text,
      'COMPLETED'::text
    ]
  ) AS status
) s
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO public.contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  s.status,
  'PENDING_WITH_EXTERNAL_STAKEHOLDERS',
  'legal.set.pending_external',
  ARRAY['LEGAL_TEAM', 'ADMIN'],
  TRUE
FROM (
  SELECT unnest(
    ARRAY[
      'UNDER_REVIEW'::text,
      'PENDING_WITH_INTERNAL_STAKEHOLDERS'::text,
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::text,
      'OFFLINE_EXECUTION'::text,
      'ON_HOLD'::text,
      'COMPLETED'::text
    ]
  ) AS status
) s
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO public.contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  s.status,
  'OFFLINE_EXECUTION',
  'legal.set.offline_execution',
  ARRAY['LEGAL_TEAM', 'ADMIN'],
  TRUE
FROM (
  SELECT unnest(
    ARRAY[
      'UNDER_REVIEW'::text,
      'PENDING_WITH_INTERNAL_STAKEHOLDERS'::text,
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::text,
      'OFFLINE_EXECUTION'::text,
      'ON_HOLD'::text,
      'COMPLETED'::text
    ]
  ) AS status
) s
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO public.contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  s.status,
  'ON_HOLD',
  'legal.set.on_hold',
  ARRAY['LEGAL_TEAM', 'ADMIN'],
  TRUE
FROM (
  SELECT unnest(
    ARRAY[
      'UNDER_REVIEW'::text,
      'PENDING_WITH_INTERNAL_STAKEHOLDERS'::text,
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::text,
      'OFFLINE_EXECUTION'::text,
      'ON_HOLD'::text,
      'COMPLETED'::text
    ]
  ) AS status
) s
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO public.contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  s.status,
  'COMPLETED',
  'legal.set.completed',
  ARRAY['LEGAL_TEAM', 'ADMIN'],
  TRUE
FROM (
  SELECT unnest(
    ARRAY[
      'UNDER_REVIEW'::text,
      'PENDING_WITH_INTERNAL_STAKEHOLDERS'::text,
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::text,
      'OFFLINE_EXECUTION'::text,
      'ON_HOLD'::text,
      'COMPLETED'::text
    ]
  ) AS status
) s
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO public.contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  s.status,
  'REJECTED',
  'legal.reject',
  ARRAY['LEGAL_TEAM', 'ADMIN'],
  TRUE
FROM (
  SELECT unnest(
    ARRAY[
      'UNDER_REVIEW'::text,
      'PENDING_WITH_INTERNAL_STAKEHOLDERS'::text,
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::text,
      'OFFLINE_EXECUTION'::text,
      'ON_HOLD'::text,
      'COMPLETED'::text
    ]
  ) AS status
) s
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO public.contract_transition_graph (tenant_id, from_status, to_status, trigger_action, allowed_roles, is_active)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  s.status,
  'VOID',
  'legal.void',
  ARRAY['LEGAL_TEAM', 'ADMIN'],
  TRUE
FROM (
  SELECT unnest(
    ARRAY[
      'UNDER_REVIEW'::text,
      'PENDING_WITH_INTERNAL_STAKEHOLDERS'::text,
      'PENDING_WITH_EXTERNAL_STAKEHOLDERS'::text,
      'OFFLINE_EXECUTION'::text,
      'ON_HOLD'::text,
      'COMPLETED'::text
    ]
  ) AS status
) s
ON CONFLICT (tenant_id, from_status, to_status, trigger_action) DO UPDATE
SET allowed_roles = EXCLUDED.allowed_roles,
    is_active = TRUE,
    updated_at = NOW();
