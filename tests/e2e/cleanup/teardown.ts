/**
 * E2E Test Data Cleanup Script — NxtLegal
 *
 * Identifies and optionally deletes contracts created by E2E tests.
 * All E2E-created contracts are prefixed with "[E2E-AUTO]" in their
 * counterparty/signatory names, making them identifiable.
 *
 * ── Strategy ─────────────────────────────────────────────────────────────────
 *
 * The E2E tests use a deliberate "leave data behind" approach:
 *
 * 1. **Unique Names**: Every test run generates unique counterparty and
 *    signatory names with timestamps (e.g. "[E2E-AUTO] Counterparty lq2x4f").
 *    This prevents collisions between parallel or repeated test runs.
 *
 * 2. **No Inline Teardown**: Tests do NOT delete contracts after running,
 *    because post-mortem inspection is valuable for debugging failures.
 *
 * 3. **Periodic Cleanup**: This script can be run manually or in CI to
 *    clean up stale E2E test data older than a configurable threshold.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   npx tsx tests/e2e/cleanup/teardown.ts          # dry run (list only)
 *   npx tsx tests/e2e/cleanup/teardown.ts --delete  # actually delete
 *   npx tsx tests/e2e/cleanup/teardown.ts --max-age=24  # delete >24h old
 *
 * ── Prerequisites ────────────────────────────────────────────────────────────
 *
 *   Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 *   (or .env.local file).
 */

const TEST_PREFIX = '[E2E-AUTO]'
const DEFAULT_MAX_AGE_HOURS = 48

async function main() {
  const args = process.argv.slice(2)
  const shouldDelete = args.includes('--delete')
  const maxAgeArg = args.find((a) => a.startsWith('--max-age='))
  const maxAgeHours = maxAgeArg ? parseInt(maxAgeArg.split('=')[1], 10) : DEFAULT_MAX_AGE_HOURS

  // Load env
  try {
    require('dotenv').config({ path: '.env.local' })
  } catch {
    // dotenv may not be available; env vars must be set externally
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    console.error('   Set them in .env.local or environment variables.')
    process.exit(1)
  }

  const cutoffDate = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString()

  console.log(`\n🔍 Scanning for E2E test contracts...`)
  console.log(`   Prefix: "${TEST_PREFIX}"`)
  console.log(`   Max age: ${maxAgeHours}h (before ${cutoffDate})`)
  console.log(`   Mode: ${shouldDelete ? '🗑️  DELETE' : '👀 DRY RUN'}\n`)

  // Query contracts with E2E prefix in title created before cutoff
  const queryUrl = `${supabaseUrl}/rest/v1/contracts?select=id,title,status,created_at&title=ilike.*${encodeURIComponent(TEST_PREFIX)}*&created_at=lt.${cutoffDate}&order=created_at.desc&limit=100`

  const response = await fetch(queryUrl, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    console.error(`❌ Supabase query failed: ${response.status} ${response.statusText}`)
    const body = await response.text()
    console.error(body)
    process.exit(1)
  }

  const contracts = (await response.json()) as Array<{
    id: string
    title: string
    status: string
    created_at: string
  }>

  if (contracts.length === 0) {
    console.log('✅ No stale E2E test contracts found.')
    return
  }

  console.log(`Found ${contracts.length} E2E test contract(s):\n`)

  for (const c of contracts) {
    const age = Math.round((Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60))
    console.log(`  📄 ${c.title}`)
    console.log(`     ID: ${c.id} | Status: ${c.status} | Age: ${age}h`)

    if (shouldDelete) {
      // Soft delete: set deleted_at timestamp
      const deleteUrl = `${supabaseUrl}/rest/v1/contracts?id=eq.${c.id}`
      const delResponse = await fetch(deleteUrl, {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      })

      if (delResponse.ok) {
        console.log(`     ✅ Soft-deleted`)
      } else {
        console.log(`     ❌ Failed to delete: ${delResponse.status}`)
      }
    }
  }

  console.log(
    shouldDelete ? `\n🗑️  Cleaned up ${contracts.length} contracts.` : `\n💡 Run with --delete to remove these.`
  )
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
