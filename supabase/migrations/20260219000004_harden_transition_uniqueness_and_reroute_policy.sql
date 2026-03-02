-- Harden transition graph determinism for contract workflow
-- 1) LEGAL_QUERY reroute must only transition back to HOD_PENDING
-- 2) Active transitions must be unique per (tenant_id, from_status, trigger_action)

-- Disable any non-compliant active reroute transitions
UPDATE contract_transition_graph
SET is_active = FALSE,
    updated_at = NOW()
WHERE is_active = TRUE
  AND trigger_action = 'legal.query.reroute'
  AND to_status <> 'HOD_PENDING';

-- Ensure no active duplicate transitions remain for the same decision edge
WITH ranked_transitions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, from_status, trigger_action
      ORDER BY created_at ASC, id ASC
    ) AS row_num
  FROM contract_transition_graph
  WHERE is_active = TRUE
)
UPDATE contract_transition_graph graph
SET is_active = FALSE,
    updated_at = NOW()
FROM ranked_transitions ranked
WHERE graph.id = ranked.id
  AND ranked.row_num > 1;

-- Enforce deterministic active transition lookup
CREATE UNIQUE INDEX IF NOT EXISTS ux_contract_transition_graph_active_decision
  ON contract_transition_graph (tenant_id, from_status, trigger_action)
  WHERE is_active = TRUE;
