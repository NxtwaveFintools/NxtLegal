import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/service'
import { appConfig } from '@/core/config/app-config'
import { googleDriveConnectionsTable } from '@/core/constants/google-drive'
import { DatabaseError } from '@/core/http/errors'
import { AesTokenCipher } from '@/core/infra/security/aes-token-cipher'
import type { TokenCipher } from '@/core/domain/drive/token-cipher'
import type { DriveConnectionRepository } from '@/core/domain/drive/drive-connection-repository'
import type { DriveConnection, DriveConnectionUpsert } from '@/core/domain/drive/types'

type DriveConnectionRow = {
  id: string
  tenant_id: string
  user_id: string
  google_account_email: string | null
  access_token: string | null
  refresh_token: string
  token_expires_at: string | null
  scope: string | null
  last_folder_id: string | null
  last_folder_name: string | null
}

const SELECT_COLUMNS =
  'id, tenant_id, user_id, google_account_email, access_token, refresh_token, token_expires_at, scope, last_folder_id, last_folder_name'

class SupabaseDriveConnectionRepository implements DriveConnectionRepository {
  private cipher: TokenCipher | null = null

  // Built lazily so importing this module never crashes when the feature is off
  // (the encryption key is only validated when the feature flag is enabled).
  private getCipher(): TokenCipher {
    if (!this.cipher) {
      const key = appConfig.googleDrive.tokenEncKey
      if (!key) {
        throw new Error('GOOGLE_DRIVE_TOKEN_ENC_KEY is not configured')
      }
      this.cipher = new AesTokenCipher(key)
    }
    return this.cipher
  }

  private toDomain(row: DriveConnectionRow): DriveConnection {
    const cipher = this.getCipher()
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      googleAccountEmail: row.google_account_email,
      accessToken: row.access_token ? cipher.decrypt(row.access_token) : null,
      refreshToken: cipher.decrypt(row.refresh_token),
      tokenExpiresAt: row.token_expires_at,
      scope: row.scope,
      lastFolderId: row.last_folder_id,
      lastFolderName: row.last_folder_name,
    }
  }

  async findByUser(params: { tenantId: string; userId: string }): Promise<DriveConnection | null> {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase
      .from(googleDriveConnectionsTable)
      .select(SELECT_COLUMNS)
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId)
      .maybeSingle()

    if (error) {
      throw new DatabaseError('Failed to load Google Drive connection', undefined, { error: error.message })
    }
    if (!data) {
      return null
    }
    return this.toDomain(data as DriveConnectionRow)
  }

  async upsert(params: DriveConnectionUpsert): Promise<DriveConnection> {
    const supabase = createServiceSupabase()
    const cipher = this.getCipher()
    const { data, error } = await supabase
      .from(googleDriveConnectionsTable)
      .upsert(
        {
          tenant_id: params.tenantId,
          user_id: params.userId,
          google_account_email: params.googleAccountEmail,
          access_token: cipher.encrypt(params.accessToken),
          refresh_token: cipher.encrypt(params.refreshToken),
          token_expires_at: params.tokenExpiresAt,
          scope: params.scope,
          last_folder_id: null,
          last_folder_name: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,user_id' }
      )
      .select(SELECT_COLUMNS)
      .single()

    if (error) {
      throw new DatabaseError('Failed to persist Google Drive connection', undefined, { error: error.message })
    }
    return this.toDomain(data as DriveConnectionRow)
  }

  async updateTokens(params: {
    tenantId: string
    userId: string
    accessToken: string
    tokenExpiresAt: string
    refreshToken?: string
  }): Promise<void> {
    const supabase = createServiceSupabase()
    const cipher = this.getCipher()
    const update: Record<string, unknown> = {
      access_token: cipher.encrypt(params.accessToken),
      token_expires_at: params.tokenExpiresAt,
      updated_at: new Date().toISOString(),
    }
    if (params.refreshToken) {
      update.refresh_token = cipher.encrypt(params.refreshToken)
    }

    const { error } = await supabase
      .from(googleDriveConnectionsTable)
      .update(update)
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId)

    if (error) {
      throw new DatabaseError('Failed to update Google Drive tokens', undefined, { error: error.message })
    }
  }

  async updateLastFolder(params: {
    tenantId: string
    userId: string
    lastFolderId: string
    lastFolderName: string
  }): Promise<void> {
    const supabase = createServiceSupabase()
    const { error } = await supabase
      .from(googleDriveConnectionsTable)
      .update({
        last_folder_id: params.lastFolderId,
        last_folder_name: params.lastFolderName,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId)

    if (error) {
      throw new DatabaseError('Failed to update last Drive folder', undefined, { error: error.message })
    }
  }

  async deleteByUser(params: { tenantId: string; userId: string }): Promise<void> {
    const supabase = createServiceSupabase()
    const { error } = await supabase
      .from(googleDriveConnectionsTable)
      .delete()
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId)

    if (error) {
      throw new DatabaseError('Failed to delete Google Drive connection', undefined, { error: error.message })
    }
  }
}

export const supabaseDriveConnectionRepository = new SupabaseDriveConnectionRepository()
