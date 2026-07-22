// scripts/seed-company-stamp.ts
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile } from 'fs/promises'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'org-assets'
const SOURCE_PATH = resolve(process.cwd(), 'supabase/assets/company-stamp.png')

/**
 * Resolves which tenant the stamp belongs to.
 *
 * Single-tenant deployments — which is every environment today — resolve
 * automatically, so the same command works unchanged against test and prod.
 * Making the operator look up and paste a UUID is friction that buys nothing
 * while there is only one answer, and a mistyped one uploads to a path
 * nothing ever reads: the stamp appears to install, then silently never shows.
 *
 * `--tenant=<uuid>` stays available and becomes REQUIRED the moment a second
 * tenant exists, so this cannot silently pick the wrong one later.
 */
async function resolveTenantId(supabase: SupabaseClient, explicitTenantId: string | undefined): Promise<string> {
  const { data, error } = await supabase.from('tenants').select('id, name').order('name')

  if (error) {
    throw new Error(`Could not read tenants to resolve the target: ${error.message}`)
  }

  const tenants = data ?? []

  if (explicitTenantId) {
    const match = tenants.find((tenant) => tenant.id === explicitTenantId)
    if (!match) {
      throw new Error(
        `No tenant with id ${explicitTenantId} exists in this project. Available: ${
          tenants.map((tenant) => `${tenant.id} (${tenant.name})`).join(', ') || 'none'
        }`
      )
    }

    return match.id
  }

  if (tenants.length === 0) {
    throw new Error('This project has no tenants, so there is nothing to attach a stamp to.')
  }

  if (tenants.length > 1) {
    throw new Error(
      `This project has ${tenants.length} tenants, so the target is ambiguous. ` +
        `Pass --tenant=<uuid>. Available: ${tenants.map((tenant) => `${tenant.id} (${tenant.name})`).join(', ')}`
    )
  }

  return tenants[0].id
}

async function main(): Promise<void> {
  const explicitTenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1]
  const confirmed = process.argv.includes('--yes')

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const tenantId = await resolveTenantId(supabase, explicitTenantId)
  const targetPath = `stamps/${tenantId}.png`

  // The failure mode that matters is running this against the wrong project,
  // so the target is always printed and never uploaded without --yes.
  console.log(`Supabase project : ${SUPABASE_URL}`)
  console.log(
    `Tenant           : ${tenantId}${explicitTenantId ? ' (from --tenant)' : ' (auto-resolved, only tenant)'}`
  )
  console.log(`Bucket / path    : ${BUCKET}/${targetPath}`)
  console.log(`Source file      : ${SOURCE_PATH}`)

  if (!confirmed) {
    console.log('\nDry run. Re-run with --yes to upload.')
    return
  }

  // Read before uploading so a missing or unreadable file fails with a clear
  // message rather than a confusing storage error.
  let stampBytes: Buffer
  try {
    stampBytes = await readFile(SOURCE_PATH)
  } catch {
    throw new Error(`No stamp image found at ${SOURCE_PATH}. Place the company stamp PNG there and re-run.`)
  }

  // upsert:true so re-running replaces. "Update the stamp" is the same
  // command as "install the stamp".
  const { error } = await supabase.storage.from(BUCKET).upload(targetPath, stampBytes, {
    contentType: 'image/png',
    upsert: true,
  })

  if (error) {
    throw new Error(
      `Upload failed: ${error.message}. ` +
        `If this says the bucket was not found, apply the org-assets bucket migration first.`
    )
  }

  console.log(`\nUploaded ${stampBytes.byteLength} bytes to ${BUCKET}/${targetPath}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
