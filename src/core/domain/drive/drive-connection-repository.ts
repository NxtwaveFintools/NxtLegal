import type { DriveConnection, DriveConnectionUpsert } from './types'

/**
 * Persistence abstraction for per-user Drive connections.
 * Implementations must scope every operation by tenantId + userId and encrypt
 * tokens at rest. Implemented in infrastructure.
 */
export interface DriveConnectionRepository {
  findByUser(params: { tenantId: string; userId: string }): Promise<DriveConnection | null>
  upsert(params: DriveConnectionUpsert): Promise<DriveConnection>
  updateTokens(params: {
    tenantId: string
    userId: string
    accessToken: string
    tokenExpiresAt: string
    refreshToken?: string
  }): Promise<void>
  updateLastFolder(params: {
    tenantId: string
    userId: string
    lastFolderId: string
    lastFolderName: string
  }): Promise<void>
  deleteByUser(params: { tenantId: string; userId: string }): Promise<void>
}
