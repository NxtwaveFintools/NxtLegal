-- Database Verification Script for Employee Login
-- Run this to diagnose Employee ID login issues
-- Usage: Run in Supabase SQL Editor or via psql

-- =========================================
-- STEP 1: Check Default Tenant Exists
-- =========================================
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM tenants WHERE id = '00000000-0000-0000-0000-000000000000'::UUID) 
    THEN '✓ Default tenant exists'
    ELSE '✗ ERROR: Default tenant missing - run fix below'
  END AS tenant_check;

-- =========================================
-- STEP 2: Check Test Employee
-- =========================================
SELECT 
  employee_id,
  tenant_id,
  email,
  full_name,
  role,
  is_active,
  CASE 
    WHEN password_hash IS NULL THEN '✗ NO PASSWORD HASH'
    WHEN password_hash = '' THEN '✗ EMPTY PASSWORD HASH'
    ELSE '✓ Password hash present'
  END AS password_status,
  CASE 
    WHEN deleted_at IS NULL THEN '✓ Active (not deleted)'
    ELSE '✗ SOFT DELETED on ' || deleted_at::TEXT
  END AS deletion_status,
  created_at,
  updated_at
FROM employees
WHERE employee_id = 'NW1007247';

-- =========================================
-- STEP 3: Check for Orphaned Employees
-- =========================================
SELECT 
  employee_id,
  email,
  tenant_id,
  is_active,
  'Missing tenant_id' AS issue
FROM employees
WHERE tenant_id IS NULL
  AND deleted_at IS NULL
LIMIT 10;

-- =========================================
-- STEP 4: Summary Statistics
-- =========================================
SELECT 
  COUNT(*) AS total_employees,
  COUNT(*) FILTER (WHERE tenant_id IS NULL) AS missing_tenant_id,
  COUNT(*) FILTER (WHERE password_hash IS NULL) AS missing_password,
  COUNT(*) FILTER (WHERE is_active = false) AS inactive,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
FROM employees;

-- =========================================
-- FIX SCRIPTS (Run if issues found)
-- =========================================

-- Fix #1: Create default tenant if missing
INSERT INTO tenants (id, name, region, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000'::UUID,
  'Default Tenant',
  'us-east-1',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Fix #2: Set tenant_id for test employee if missing
UPDATE employees 
SET 
  tenant_id = '00000000-0000-0000-0000-000000000000'::UUID,
  updated_at = NOW()
WHERE employee_id = 'NW1007247'
  AND (tenant_id IS NULL OR tenant_id != '00000000-0000-0000-0000-000000000000'::UUID);

-- Fix #3: Activate test employee if inactive
UPDATE employees
SET 
  is_active = true,
  updated_at = NOW()
WHERE employee_id = 'NW1007247'
  AND is_active = false;

-- Fix #4: Restore test employee if soft-deleted
UPDATE employees
SET 
  deleted_at = NULL,
  updated_at = NOW()
WHERE employee_id = 'NW1007247'
  AND deleted_at IS NOT NULL;

-- =========================================
-- VERIFICATION: Run after fixes
-- =========================================
SELECT 
  'Test Employee Status' AS check_name,
  CASE 
    WHEN COUNT(*) = 1 
      AND BOOL_AND(tenant_id = '00000000-0000-0000-0000-000000000000'::UUID)
      AND BOOL_AND(password_hash IS NOT NULL)
      AND BOOL_AND(is_active = true)
      AND BOOL_AND(deleted_at IS NULL)
    THEN '✓ ALL CHECKS PASSED - Employee Login should work'
    ELSE '✗ ISSUES REMAIN - Check details above'
  END AS status
FROM employees
WHERE employee_id = 'NW1007247';

-- =========================================
-- EXPECTED TEST CREDENTIALS
-- =========================================
-- Employee ID: NW1007247 (case-insensitive)
-- Password: password
-- Expected Password Hash: $2b$10$teTBiSY5.ZhLKV/M55.BluPg/DvmSZPoiqoHbN6489YXsLzS/23hO
-- Tenant ID: 00000000-0000-0000-0000-000000000000
-- =========================================
