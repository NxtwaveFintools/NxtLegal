-- =============================================================================
-- Migration: Reassign Deepika Yadav's pending contracts to Akash Garg
--
-- Context : Deepika Yadav was deactivated in migration 20260608100000.
--           Her department assignments (Facilities, HR Operations) were
--           transferred to Akash Garg. However, contracts already sitting
--           with Deepika as current_assignee were not moved. This migration
--           reassigns those pending contracts to Akash so he can continue.
--
-- Scope   : contracts WHERE
--             current_assignee_email = 'yadav.deepika@nxtwave.co.in'
--             AND status NOT IN ('COMPLETED','EXECUTED','REJECTED','VOID')
--             AND deleted_at IS NULL
--
-- Date       : 2026-06-09
-- Idempotent : YES — WHERE clause is self-limiting; safe to re-run
-- =============================================================================

DO $$
DECLARE
  v_akash_email    text := 'akash.garg@nxtwave.co.in';
  v_akash_user_id  text;
  v_contract_count int;
BEGIN

  -- current_assignee_employee_id stores the public.users UUID (despite the name)
  SELECT id::text INTO v_akash_user_id
  FROM public.users
  WHERE email      = v_akash_email
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_akash_user_id IS NULL THEN
    RAISE EXCEPTION 'User "%" not found in public.users', v_akash_email;
  END IF;

  -- Reassign all pending contracts from Deepika to Akash
  UPDATE public.contracts
  SET
    current_assignee_email       = v_akash_email,
    current_assignee_employee_id = v_akash_user_id,
    updated_at                   = NOW()
  WHERE current_assignee_email = 'yadav.deepika@nxtwave.co.in'
    AND status NOT IN ('COMPLETED', 'EXECUTED', 'REJECTED', 'VOID')
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_contract_count = ROW_COUNT;
  RAISE NOTICE 'Reassigned % pending contract(s) from Deepika Yadav → Akash Garg', v_contract_count;

END $$;
