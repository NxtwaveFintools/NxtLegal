alter table public.contract_additional_approvers
  add column if not exists assignment_note_text text,
  add column if not exists decision_note_text text;

with ranked_assignment_notes as (
  select
    resource_id,
    target_email,
    nullif(metadata ->> 'sequence_order', '')::integer as sequence_order,
    note_text,
    row_number() over (
      partition by resource_id, target_email, metadata ->> 'sequence_order'
      order by created_at desc, event_sequence desc
    ) as row_rank
  from public.audit_logs
  where resource_type = 'contract'
    and action = 'contract.approver.added'
    and note_text is not null
    and btrim(note_text) <> ''
)
update public.contract_additional_approvers as caa
set assignment_note_text = ran.note_text
from ranked_assignment_notes as ran
where ran.row_rank = 1
  and caa.assignment_note_text is null
  and caa.contract_id::text = ran.resource_id
  and caa.approver_email = ran.target_email
  and caa.sequence_order = ran.sequence_order;

with ranked_decision_notes as (
  select
    metadata ->> 'approver_id' as approver_id,
    note_text,
    row_number() over (
      partition by metadata ->> 'approver_id'
      order by created_at desc, event_sequence desc
    ) as row_rank
  from public.audit_logs
  where resource_type = 'contract'
    and action in ('contract.approver.approved', 'contract.approver.rejected')
    and metadata ? 'approver_id'
    and note_text is not null
    and btrim(note_text) <> ''
)
update public.contract_additional_approvers as caa
set decision_note_text = rdn.note_text
from ranked_decision_notes as rdn
where rdn.row_rank = 1
  and caa.decision_note_text is null
  and caa.id::text = rdn.approver_id;
