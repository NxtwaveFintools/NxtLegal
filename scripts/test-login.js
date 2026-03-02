#!/usr/bin/env tsx
/**
 * Manual Login Test Script
 * Tests email-based login flow with role-aligned test credentials
 * Usage: npm run test:login
 */

import { config } from 'dotenv'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { verifyPassword } from '../src/lib/auth/password'
import { DEFAULT_TENANT_ID } from '../src/core/constants/tenants'

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') })

const TEST_EMAIL = 'poc@nxtwave.co.in'
const TEST_PASSWORD = 'Password@123'

async function testLogin() {
  console.log('🔐 Testing Email Login Flow...\n')
  
  // Check required environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL not found in environment')
    console.log('💡 Create .env.local file with Supabase credentials')
    process.exit(1)
  }
  
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment')
    console.log('💡 Add SUPABASE_SERVICE_ROLE_KEY to .env.local')
    process.exit(1)
  }
  
  console.log(`Email: ${TEST_EMAIL}`)
  console.log(`Password: ${TEST_PASSWORD}`)
  console.log(`Tenant ID: ${DEFAULT_TENANT_ID}\n`)

  // Initialize Supabase client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )

  console.log('Step 1: Verifying user exists...')
  const { data: employee, error: fetchError } = await supabase
    .from('users')
    .select('*')
    .eq('email', TEST_EMAIL)
    .eq('tenant_id', DEFAULT_TENANT_ID)
    .is('deleted_at', null)
    .single()

  if (fetchError || !employee) {
    console.error('❌ User not found:', fetchError?.message || 'No data returned')
    console.log('\n💡 Run: npm run seed:test-employee')
    process.exit(1)
  }

  console.log('✅ User found:', {
    id: employee.id,
    email: employee.email,
    fullName: employee.full_name,
    isActive: employee.is_active,
    role: employee.role,
    tenantId: employee.tenant_id,
    hasPassword: employee.password_hash ? '✅ Yes' : '❌ No',
  })

  if (!employee.password_hash) {
    console.error('\n❌ User has no password hash (OAuth-only account)')
    console.log('💡 Run: npm run seed:test-employee to set password')
    process.exit(1)
  }

  if (!employee.is_active) {
    console.error('\n❌ User account is inactive')
    process.exit(1)
  }

  console.log('\nStep 2: Verifying password...')
  const isValidPassword = await verifyPassword(TEST_PASSWORD, employee.password_hash)

  if (!isValidPassword) {
    console.error('❌ Password verification failed')
    console.log('💡 Expected password: "Password@123"')
    console.log('💡 Run: npm run seed:test-employee to reset password')
    process.exit(1)
  }

  console.log('✅ Password verified successfully')

  console.log('\nStep 3: Checking tenant isolation...')
  // Try to find user in wrong tenant (should fail)
  const wrongTenantId = '11111111-1111-1111-1111-111111111111'
  const { data: crossTenantCheck } = await supabase
    .from('users')
    .select('*')
    .eq('email', TEST_EMAIL)
    .eq('tenant_id', wrongTenantId)
    .is('deleted_at', null)
    .single()

  if (crossTenantCheck) {
    console.error('❌ Tenant isolation failed - user found in wrong tenant!')
    process.exit(1)
  }

  console.log('✅ Tenant isolation working correctly')

  console.log('\n✅ All login flow checks passed!')
  console.log('\n🎉 Email login should work via API:')
  console.log('   POST http://localhost:3000/api/auth/login')
  console.log('   {')
  console.log(`     "email": "${TEST_EMAIL}",`)
  console.log(`     "password": "${TEST_PASSWORD}"`)
  console.log('   }')
  console.log('\n💡 Start dev server: npm run dev')
}

testLogin().catch((error) => {
  console.error('\n❌ Test failed:', error)
  process.exit(1)
})
