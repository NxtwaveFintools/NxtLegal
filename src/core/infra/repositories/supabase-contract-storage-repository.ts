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

  async createSignedUploadUrl(path: string): Promise<{ path: string; token: string; signedUrl: string }> {
    const supabase = createServiceSupabase()
    const storage = supabase.storage.from(contractStorage.privateBucketName) as unknown as {
      createSignedUploadUrl: (
        path: string
      ) => Promise<{
        data: { path?: string; token?: string; signedUrl?: string } | null
        error: { message: string } | null
      }>
    }

    const { data, error } = await storage.createSignedUploadUrl(path)

    if (error || !data?.token || !data?.signedUrl) {
      throw new ExternalServiceError('supabase-storage', error?.message ?? 'Failed to create signed upload URL')
    }

    return {
      path: data.path ?? path,
      token: data.token,
      signedUrl: data.signedUrl,
    }
  }

  async exists(path: string): Promise<boolean> {
    const supabase = createServiceSupabase()
    const normalizedPath = path.replace(/\\/g, '/')
    const segments = normalizedPath.split('/').filter(Boolean)
    const fileName = segments.pop()
    const folder = segments.join('/')

    if (!fileName || !folder) {
      return false
    }

    const { data, error } = await supabase.storage.from(contractStorage.privateBucketName).list(folder, {
      search: fileName,
      limit: 100,
    })

    if (error) {
      throw new ExternalServiceError('supabase-storage', `Failed to check object existence: ${error.message}`)
    }

    return (data ?? []).some((entry) => entry.name === fileName)
  }
}

export const supabaseContractStorageRepository = new SupabaseContractStorageRepository()
