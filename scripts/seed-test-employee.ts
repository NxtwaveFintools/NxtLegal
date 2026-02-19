/**
 * Script to seed role-aligned development users for email-based authentication.
 *
 * Usage:
 *   npm run seed:test-employee
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
const DEV_PASSWORD = 'Password@123'

const DEV_USERS = [
  {
    email: 'poc@nxtwave.co.in',
    fullName: 'Finance POC',
    role: 'POC',
    team: 'Finance',
  },
  {
    email: 'hod@nxtwave.co.in',
    fullName: 'Finance HOD',
    role: 'HOD',
    team: 'Finance',
  },
  {
    email: 'legalteam@nxtwave.co.in',
    fullName: 'Legal Team',
    role: 'LEGAL_TEAM',
    team: null,
  },
  {
    email: 'admin@nxtwave.co.in',
    fullName: 'System Admin',
    role: 'ADMIN',
    team: null,
  },
] as const

const FINANCE_TEAM_NAME = 'Finance'

async function seedTestEmployee() {
  console.log('🌱 Seeding role-based test users...\n')

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

    // Step 2: Ensure users table is available
    console.log('\n2️⃣  Validating users/teams schema...')
    const { error: usersTableCheckError } = await supabase.from('users').select('id').limit(1)
    if (usersTableCheckError) {
      throw new Error(
        `users table is unavailable (${usersTableCheckError.message}). Apply latest migrations before seeding.`
      )
    }

    const { error: teamsTableCheckError } = await supabase.from('teams').select('id').limit(1)
    if (teamsTableCheckError) {
      throw new Error(
        `teams table is unavailable (${teamsTableCheckError.message}). Apply latest migrations before seeding.`
      )
    }

    // Step 3: Hash password
    console.log('\n2️⃣  Hashing password...')
    const passwordHash = await hashPassword(DEV_PASSWORD)
    console.log('   ✓ Password hashed')

    // Step 4: Ensure Finance team exists
    console.log('\n4️⃣  Ensuring Finance team exists...')
    const { data: existingTeam, error: teamLookupError } = await supabase
      .from('teams')
      .select('id')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .eq('name', FINANCE_TEAM_NAME)
      .is('deleted_at', null)
      .maybeSingle()

    if (teamLookupError) {
      throw new Error(`Failed to lookup team: ${teamLookupError.message}`)
    }

    let financeTeamId = existingTeam?.id ?? null
    if (!financeTeamId) {
      const { data: createdTeam, error: teamCreateError } = await supabase
        .from('teams')
        .insert({
          tenant_id: DEFAULT_TENANT_ID,
          name: FINANCE_TEAM_NAME,
          poc_email: 'poc@nxtwave.co.in',
          hod_email: 'hod@nxtwave.co.in',
        })
        .select('id')
        .single()

      if (teamCreateError) {
        throw new Error(`Failed to create team: ${teamCreateError.message}`)
      }
      financeTeamId = createdTeam.id
      console.log('   ✓ Finance team created')
    } else {
      const { error: teamUpdateError } = await supabase
        .from('teams')
        .update({
          poc_email: 'poc@nxtwave.co.in',
          hod_email: 'hod@nxtwave.co.in',
          deleted_at: null,
        })
        .eq('id', financeTeamId)

      if (teamUpdateError) {
        throw new Error(`Failed to update team: ${teamUpdateError.message}`)
      }
      console.log('   ✓ Finance team updated')
    }

    // Step 5: Seed users idempotently by email
    console.log('\n5️⃣  Seeding users...')
    for (const devUser of DEV_USERS) {
      const { data: existingUser, error: userLookupError } = await supabase
        .from('users')
        .select('id, email')
        .eq('tenant_id', DEFAULT_TENANT_ID)
        .eq('email', devUser.email)
        .maybeSingle()

      if (userLookupError) {
        throw new Error(`Failed to lookup user ${devUser.email}: ${userLookupError.message}`)
      }

      const payload = {
        tenant_id: DEFAULT_TENANT_ID,
        email: devUser.email,
        full_name: devUser.fullName,
        password_hash: passwordHash,
        role: devUser.role,
        team_id: devUser.team ? financeTeamId : null,
        is_active: true,
        deleted_at: null,
      }

      if (existingUser) {
        const { error: updateUserError } = await supabase.from('users').update(payload).eq('id', existingUser.id)
        if (updateUserError) {
          throw new Error(`Failed to update user ${devUser.email}: ${updateUserError.message}`)
        }
        console.log(`   ✓ Updated ${devUser.email} (${devUser.role})`)
      } else {
        const { error: createUserError } = await supabase.from('users').insert(payload)
        if (createUserError) {
          throw new Error(`Failed to create user ${devUser.email}: ${createUserError.message}`)
        }
        console.log(`   ✓ Created ${devUser.email} (${devUser.role})`)
      }
    }

    // Step 6: Verification
    console.log('\n6️⃣  Verifying users...')
    const { data: verifyUsers, error: verifyUsersError } = await supabase
      .from('users')
      .select('email, role, team_id, tenant_id, password_hash, is_active, deleted_at')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .in(
        'email',
        DEV_USERS.map((user) => user.email)
      )

    if (verifyUsersError) {
      throw new Error(`Failed to verify users: ${verifyUsersError.message}`)
    }

    if (!verifyUsers || verifyUsers.length !== DEV_USERS.length) {
      throw new Error('Verification failed: not all development users were seeded')
    }

    console.log('\n✅ Role-based test users seeded successfully!\n')
    console.log('📝 Dev Credentials (all users):')
    console.log(`   Password: ${DEV_PASSWORD}`)
    DEV_USERS.forEach((user) => {
      console.log(`   - ${user.email} | ${user.role} | team=${user.team ?? 'GLOBAL'}`)
    })
    console.log(`\n   Tenant ID: ${DEFAULT_TENANT_ID}`)
    console.log('\n🚀 You can now login at: http://localhost:3000/login')
  } catch (error) {
    console.error('\n❌ Seed failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// Run the seed
seedTestEmployee()
