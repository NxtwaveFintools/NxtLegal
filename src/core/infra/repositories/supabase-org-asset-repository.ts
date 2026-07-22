import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/service'
import { orgAssetStorage } from '@/core/constants/contracts'

class SupabaseOrgAssetRepository {
  /**
   * Returns the tenant's stamp image bytes, or undefined when no stamp is
   * configured. Callers must treat undefined as a hard stop when stamp fields
   * are present — never as "send without the stamp".
   */
  async findStampBytes(tenantId: string): Promise<Uint8Array | undefined> {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase.storage
      .from(orgAssetStorage.privateBucketName)
      .download(orgAssetStorage.stampPathForTenant(tenantId))

    if (error || !data) {
      return undefined
    }

    return new Uint8Array(await data.arrayBuffer())
  }

  /** Signed URL for the editor preview, or undefined when no stamp is configured. */
  async findStampSignedUrl(tenantId: string): Promise<string | undefined> {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase.storage
      .from(orgAssetStorage.privateBucketName)
      .createSignedUrl(orgAssetStorage.stampPathForTenant(tenantId), orgAssetStorage.signedUrlExpirySeconds)

    if (error || !data?.signedUrl) {
      return undefined
    }

    return data.signedUrl
  }
}

export const supabaseOrgAssetRepository = new SupabaseOrgAssetRepository()
