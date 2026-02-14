/**
 * Script to seed/reset test employee for development
 *
 * Usage:
 *   npm run seed:test-employee
 *
 * Environment variables required:
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key with database access
 *   SUPABASE_URL - Supabase project URL
 *
 * This script:
 * 1. Ensures default tenant exists
 * 2. Creates or updates test employee with correct credentials
 * 3. Idempotent - safe to run multiple times
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { hashPassword } from '../src/lib/auth/password.js'

// Load .env.local for development
config({ path: resolve(process.cwd(), '.env.local') })

// Load environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables:')
  console.error('   NEXT_PUBLIC_SUPABASE_URL')
  console.error('   SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const TEST_EMPLOYEE = {
  employeeId: 'NW1007247',
  email: 'vadla.tejeswarachari.nxtwave.co.in',
  fullName: 'Vadla Tejeswar Achari',
  password: 'password',
  role: 'viewer',
}

async function seedTestEmployee() {
  console.log('🌱 Seeding test employee...\n')

  try {
    // Step 1: Ensure default tenant exists
    console.log('1️⃣  Ensuring default tenant exists...')
    const { data: existingTenant, error: tenantCheckError } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('id', DEFAULT_TENANT_ID)
      .single()

    if (tenantCheckError && tenantCheckError.code !== 'PGRST116') {
      throw new Error(`Failed to check tenant: ${tenantCheckError.message}`)
    }

    if (!existingTenant) {
      const { error: tenantInsertError } = await supabase.from('tenants').insert({
        id: DEFAULT_TENANT_ID,
        name: 'Default Tenant',
        region: 'us-east-1',
      })

      if (tenantInsertError) {
        throw new Error(`Failed to create tenant: ${tenantInsertError.message}`)
      }
      console.log('   ✓ Created default tenant')
    } else {
      console.log(`   ✓ Default tenant exists: ${existingTenant.name}`)
    }

    // Step 2: Hash password
    console.log('\n2️⃣  Hashing password...')
    const passwordHash = await hashPassword(TEST_EMPLOYEE.password)
    console.log('   ✓ Password hashed')

    // Step 3: Check if employee exists
    console.log('\n3️⃣  Checking if employee exists...')
    const { data: existingEmployee, error: employeeCheckError } = await supabase
      .from('employees')
      .select('id, employee_id, email, is_active, deleted_at')
      .eq('employee_id', TEST_EMPLOYEE.employeeId)
      .single()

    if (employeeCheckError && employeeCheckError.code !== 'PGRST116') {
      throw new Error(`Failed to check employee: ${employeeCheckError.message}`)
    }

    if (existingEmployee) {
      console.log(`   ✓ Employee exists: ${existingEmployee.employee_id}`)
      console.log(`     - Active: ${existingEmployee.is_active}`)
      console.log(`     - Deleted: ${existingEmployee.deleted_at ? 'Yes' : 'No'}`)

      // Update existing employee
      console.log('\n4️⃣  Updating existing employee...')
      const { error: updateError } = await supabase
        .from('employees')
        .update({
          tenant_id: DEFAULT_TENANT_ID,
          email: TEST_EMPLOYEE.email,
          full_name: TEST_EMPLOYEE.fullName,
          password_hash: passwordHash,
          role: TEST_EMPLOYEE.role,
          is_active: true,
          deleted_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('employee_id', TEST_EMPLOYEE.employeeId)

      if (updateError) {
        throw new Error(`Failed to update employee: ${updateError.message}`)
      }
      console.log('   ✓ Employee updated')
    } else {
      console.log('   ⓘ Employee does not exist')

      // Insert new employee
      console.log('\n4️⃣  Creating new employee...')
      const { error: insertError } = await supabase.from('employees').insert({
        employee_id: TEST_EMPLOYEE.employeeId,
        tenant_id: DEFAULT_TENANT_ID,
        email: TEST_EMPLOYEE.email,
        full_name: TEST_EMPLOYEE.fullName,
        password_hash: passwordHash,
        role: TEST_EMPLOYEE.role,
        is_active: true,
      })

      if (insertError) {
        throw new Error(`Failed to create employee: ${insertError.message}`)
      }
      console.log('   ✓ Employee created')
    }

    // Step 4: Verify setup
    console.log('\n5️⃣  Verifying setup...')
    const { data: verifyEmployee, error: verifyError } = await supabase
      .from('employees')
      .select('employee_id, tenant_id, email, full_name, role, is_active, deleted_at, password_hash')
      .eq('employee_id', TEST_EMPLOYEE.employeeId)
      .single()

    if (verifyError) {
      throw new Error(`Failed to verify employee: ${verifyError.message}`)
    }

    const checks = [
      { name: 'Employee ID', value: verifyEmployee.employee_id === TEST_EMPLOYEE.employeeId },
      { name: 'Tenant ID', value: verifyEmployee.tenant_id === DEFAULT_TENANT_ID },
      { name: 'Email', value: verifyEmployee.email === TEST_EMPLOYEE.email },
      { name: 'Password hash', value: !!verifyEmployee.password_hash },
      { name: 'Active', value: verifyEmployee.is_active === true },
      { name: 'Not deleted', value: verifyEmployee.deleted_at === null },
    ]

    console.log('\n   Verification Results:')
    checks.forEach((check) => {
      console.log(`   ${check.value ? '✓' : '✗'} ${check.name}`)
    })

    const allPassed = checks.every((c) => c.value)
    if (!allPassed) {
      throw new Error('Verification failed - see results above')
    }

    console.log('\n✅ Test employee seeded successfully!\n')
    console.log('📝 Test Credentials:')
    console.log(`   Employee ID: ${TEST_EMPLOYEE.employeeId} (case-insensitive)`)
    console.log(`   Password:    ${TEST_EMPLOYEE.password}`)
    console.log(`   Email:       ${TEST_EMPLOYEE.email}`)
    console.log(`   Tenant ID:   ${DEFAULT_TENANT_ID}`)
    console.log('\n🚀 You can now login at: http://localhost:3000/login')
  } catch (error) {
    console.error('\n❌ Seed failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// Run the seed
seedTestEmployee()
