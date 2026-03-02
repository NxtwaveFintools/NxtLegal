import 'server-only'

import { contractStorage } from '@/core/constants/contracts'
import { ExternalServiceError } from '@/core/http/errors'
import { createServiceSupabase } from '@/lib/supabase/service'
import type { ContractStorageRepository } from '@/core/domain/contracts/contract-storage-repository'

class SupabaseContractStorageRepository implements ContractStorageRepository {
  async upload(params: { path: string; fileBody: Blob | Uint8Array; contentType: string }): Promise<void> {
    const supabase = createServiceSupabase()

    const { error } = await supabase.storage
      .from(contractStorage.privateBucketName)
      .upload(params.path, params.fileBody, {
        contentType: params.contentType,
        upsert: false,
      })

    if (error) {
      throw new ExternalServiceError('supabase-storage', `Contract upload failed: ${error.message}`)
    }
  }

  async remove(path: string): Promise<void> {
    const supabase = createServiceSupabase()

    const { error } = await supabase.storage.from(contractStorage.privateBucketName).remove([path])
    if (error) {
      throw new ExternalServiceError('supabase-storage', `Contract rollback remove failed: ${error.message}`)
    }
  }

  async createSignedDownloadUrl(path: string, expiresInSeconds: number): Promise<string> {
    const supabase = createServiceSupabase()

    const { data, error } = await supabase.storage
      .from(contractStorage.privateBucketName)
      .createSignedUrl(path, expiresInSeconds)

    if (error || !data?.signedUrl) {
      throw new ExternalServiceError('supabase-storage', error?.message ?? 'Failed to create signed download URL')
    }

    return data.signedUrl
  }
}

export const supabaseContractStorageRepository = new SupabaseContractStorageRepository()
