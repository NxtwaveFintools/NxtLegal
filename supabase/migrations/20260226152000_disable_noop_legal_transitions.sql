-- Disable no-op legal status transitions to avoid redundant actions in UI.

UPDATE public.contract_transition_graph
SET is_active = FALSE,
    updated_at = NOW()
WHERE is_active = TRUE
  AND from_status = to_status
  AND trigger_action IN (
    'legal.set.under_review',
    'legal.set.pending_internal',
    'legal.set.pending_external',
    'legal.set.offline_execution',
    'legal.set.on_hold',
    'legal.set.completed'
  );
