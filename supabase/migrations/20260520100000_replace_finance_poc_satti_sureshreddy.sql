-- ============================================================
-- Migration: Replace Finance Operations POC
-- Old POC : Hemanth Kothuru     (hemanth.kothuru@nxtwave.co.in)
-- New POC : Satti Suresh Reddy  (satti.sureshreddy@nxtwave.co.in)
-- Date    : 2026-05-20
-- ============================================================

-- Step 1: Add Satti Suresh Reddy to the users table as POC for Finance Operations
INSERT INTO public.users (tenant_id, email, full_name, role, team_id, is_active, password_hash)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'satti.sureshreddy@nxtwave.co.in',
  'Satti Suresh Reddy',
  'POC',
  'cb318e75-cf8a-439b-b7a2-32300961073f',  -- Finance Operations team
  true,
  NULL  -- OAuth (Microsoft AD) login; no password required
);

-- Step 2: Add Satti Suresh Reddy to the employees table
INSERT INTO public.employees (employee_id, email, full_name, tenant_id, is_active, role)
VALUES (
  'NW0005535',
  'satti.sureshreddy@nxtwave.co.in',
  'Satti Suresh Reddy',
  '00000000-0000-0000-0000-000000000000',
  true,
  'viewer'
);

-- Step 3: Retire Hemanth Kothuru's active POC mapping
UPDATE public.team_role_mappings
SET active_flag = false,
    replaced_at = now(),
    updated_at  = now()
WHERE id = 'bfaf6a5e-4570-4ce4-a7da-52a054f91103';  -- Hemanth's POC mapping row

-- Step 4: Insert Satti as the new active POC in team_role_mappings
INSERT INTO public.team_role_mappings (tenant_id, team_id, email, role_type, active_flag, assigned_at, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'cb318e75-cf8a-439b-b7a2-32300961073f',  -- Finance Operations team
  'satti.sureshreddy@nxtwave.co.in',
  'POC',
  true,
  now(),
  now(),
  now()
);

-- Step 5: Update the denormalized POC fields on the teams table
UPDATE public.teams
SET poc_name   = 'Satti Suresh Reddy',
    poc_email  = 'satti.sureshreddy@nxtwave.co.in',
    updated_at = now()
WHERE id = 'cb318e75-cf8a-439b-b7a2-32300961073f';  -- Finance Operations team
