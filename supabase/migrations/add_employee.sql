-- Quick Employee Creation Query
-- Use this to add new employees after running the main migration

-- Example: Create employee NW1007247 with password "password"
INSERT INTO employees (employee_id, password_hash, email, full_name, is_active)
VALUES (
  'NW1007247',
  '$2b$10$teTBiSY5.ZhLKV/M55.BluPg/DvmSZPoiqoHbN6489YXsLzS/23hO',
  'test@nxtwave.co.in',
  'Test Employee',
  true
)
ON CONFLICT (employee_id) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- To create more employees:
-- 1. Generate password hash using: node scripts/hash-password.js
-- 2. Replace values below and run this query

/*
INSERT INTO employees (employee_id, password_hash, email, full_name, is_active)
VALUES (
  'NW1007248',  -- Replace with actual Employee ID
  'YOUR_BCRYPT_HASH_HERE',  -- Get from hash-password.js
  'employee@nxtwave.co.in',  -- Optional email
  'Employee Full Name',  -- Optional name
  true  -- Set to false to deactivate
);
*/
