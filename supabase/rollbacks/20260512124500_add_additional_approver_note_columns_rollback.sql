alter table public.contract_additional_approvers
  drop column if exists assignment_note_text,
  drop column if exists decision_note_text;
