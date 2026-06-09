-- =============================================================================
-- Migration: Update Product Design POC to Akshita Choubey,
--            remove access for Nandigam Sivani Sanjana + Deepika Yadav,
--            transfer Deepika's HR Operations assignment to Akash Garg
-- Date: 2026-06-08
-- Idempotent: YES (safe to re-run)
--
-- Key facts verified from live DB before writing this migration:
--   - akshita.choubey@nxtwave.co.in does NOT exist in users — no manual creation
--     needed; the OAuth flow auto-creates her on first Microsoft login as long
--     as she has an active team_role_mappings entry (added in STEP 3 below)
--   - Product Design (b12d2e66) currently has nandigam.sivanisanjana as POC
--   - Deepika Yadav's Facilities assignment is ALREADY is_active=false → skip
--   - Akash Garg is ALREADY assigned to Facilities (active) → skip that team
--   - Only HR Operations (ad781aef) needs to be transferred to Akash
-- =============================================================================

-- -----------------------------------------------------------------------
-- STEP 1: Update Product Design team's POC fields to Akshita Choubey
-- -----------------------------------------------------------------------
UPDATE public.teams
SET
    poc_email  = 'akshita.choubey@nxtwave.co.in',
    poc_name   = 'Akshita Choubey',
    updated_at = NOW()
WHERE id = 'b12d2e66-812a-4427-a27a-d3b526b4d65b';  -- Product Design

-- -----------------------------------------------------------------------
-- STEP 2: Deactivate Nandigam Sivani Sanjana's POC entry in team_role_mappings
--         (team_role_mappings row id: 5a58c9be-5ab1-4923-ac4a-4fa08d7fc926)
-- -----------------------------------------------------------------------
UPDATE public.team_role_mappings
SET
    active_flag = false,
    updated_at  = NOW()
WHERE team_id   = 'b12d2e66-812a-4427-a27a-d3b526b4d65b'
  AND email     = 'nandigam.sivanisanjana@nxtwave.co.in'
  AND role_type = 'POC';

-- -----------------------------------------------------------------------
-- STEP 3: Add Akshita Choubey as active POC in team_role_mappings
--         for Product Design (skips if already present and active)
-- -----------------------------------------------------------------------
INSERT INTO public.team_role_mappings (
    id,
    tenant_id,
    team_id,
    email,
    role_type,
    active_flag,
    assigned_at,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'b12d2e66-812a-4427-a27a-d3b526b4d65b',  -- Product Design
    'akshita.choubey@nxtwave.co.in',
    'POC',
    true,
    NOW(),
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM public.team_role_mappings
    WHERE team_id     = 'b12d2e66-812a-4427-a27a-d3b526b4d65b'
      AND email       = 'akshita.choubey@nxtwave.co.in'
      AND role_type   = 'POC'
      AND active_flag = true
);

-- -----------------------------------------------------------------------
-- STEP 4: Deactivate Nandigam Sivani Sanjana's user account
-- -----------------------------------------------------------------------
UPDATE public.users
SET
    is_active  = false,
    deleted_at = COALESCE(deleted_at, NOW()),
    updated_at = NOW()
WHERE email = 'nandigam.sivanisanjana@nxtwave.co.in';

-- -----------------------------------------------------------------------
-- STEP 5: Deactivate Deepika Yadav's user account
-- -----------------------------------------------------------------------
UPDATE public.users
SET
    is_active  = false,
    deleted_at = COALESCE(deleted_at, NOW()),
    updated_at = NOW()
WHERE email = 'yadav.deepika@nxtwave.co.in';

-- -----------------------------------------------------------------------
-- STEP 6: Deactivate Deepika Yadav's remaining active department_legal_assignments
--         (Facilities is already inactive — this only hits HR Operations)
-- -----------------------------------------------------------------------
UPDATE public.department_legal_assignments
SET
    is_active  = false,
    revoked_at = COALESCE(revoked_at, NOW()),
    updated_at = NOW()
WHERE user_id   = 'fac51809-6054-4eaa-a337-82bd30800d66'  -- Deepika Yadav
  AND is_active = true;

-- -----------------------------------------------------------------------
-- STEP 7: Assign Akash Garg to HR Operations (transferred from Deepika)
--         Akash is already active on Facilities → no action needed there.
-- -----------------------------------------------------------------------
INSERT INTO public.department_legal_assignments (
    id,
    tenant_id,
    department_id,
    user_id,
    is_active,
    assigned_at,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'ad781aef-1b1f-432c-a7c7-dc1cb205f561',  -- HR Operations
    'c757e3f4-c5aa-44dc-874f-39a90526166c',  -- Akash Garg
    true,
    NOW(),
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM public.department_legal_assignments
    WHERE user_id       = 'c757e3f4-c5aa-44dc-874f-39a90526166c'
      AND department_id = 'ad781aef-1b1f-432c-a7c7-dc1cb205f561'
      AND is_active     = true
);
