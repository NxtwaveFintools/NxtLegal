import type { Logger } from '@/core/infra/logging/types'
import { BusinessRuleError } from '@/core/http/errors'
import { googleDriveErrorCodes, googleDriveLimits, googleDriveOauth } from '@/core/constants/google-drive'
import type { DriveApiRepository } from './drive-api-repository'
import type { DriveConnectionRepository } from './drive-connection-repository'
import type { DriveOAuthClient } from './drive-oauth-client'
import type { DriveConnectionStatus, DriveFile, DriveFolder, DriveImportedFile, DriveUploadResult } from './types'

type UserScope = { tenantId: string; userId: string }

/**
 * Orchestrates the per-user Google Drive integration:
 * OAuth handshake, token lifecycle (refresh + persistence), folder browsing,
 * export (upload) and import (download). Pure domain logic — all I/O is injected.
 */
export class DriveService {
  constructor(
    private readonly oauthClient: DriveOAuthClient,
    private readonly driveApi: DriveApiRepository,
    private readonly connectionRepository: DriveConnectionRepository,
    private readonly logger: Logger
  ) {}

  buildAuthorizationUrl(params: { state: string; redirectUri: string }): string {
    return this.oauthClient.buildAuthorizationUrl(params)
  }

  async completeAuthorization(params: {
    tenantId: string
    userId: string
    code: string
    redirectUri: string
  }): Promise<void> {
    const tokenSet = await this.oauthClient.exchangeAuthorizationCode({
      code: params.code,
      redirectUri: params.redirectUri,
    })

    if (!tokenSet.refreshToken) {
      // Without a refresh token we cannot maintain offline access. This happens if
      // the user previously consented and Google skipped re-issuing one.
      throw new BusinessRuleError(
        googleDriveErrorCodes.authExpired,
        'Google did not return offline access. Please reconnect and approve access.'
      )
    }

    const accountEmail = await this.driveApi.getAccountEmail({ accessToken: tokenSet.accessToken }).catch(() => null)

    await this.connectionRepository.upsert({
      tenantId: params.tenantId,
      userId: params.userId,
      googleAccountEmail: accountEmail,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      tokenExpiresAt: this.computeExpiry(tokenSet.expiresInSeconds),
      scope: tokenSet.scope,
    })

    this.logger.info('Google Drive connection established', {
      tenantId: params.tenantId,
      userId: params.userId,
    })
  }

  async getStatus(params: UserScope): Promise<DriveConnectionStatus> {
    const connection = await this.connectionRepository.findByUser(params)
    if (!connection) {
      return { connected: false, googleAccountEmail: null, lastFolder: null }
    }

    return {
      connected: true,
      googleAccountEmail: connection.googleAccountEmail,
      lastFolder: connection.lastFolderId
        ? { id: connection.lastFolderId, name: connection.lastFolderName ?? 'Selected folder' }
        : null,
    }
  }

  async disconnect(params: UserScope): Promise<void> {
    const connection = await this.connectionRepository.findByUser(params)
    if (connection?.refreshToken) {
      await this.oauthClient.revokeToken({ token: connection.refreshToken }).catch((error) => {
        this.logger.warn('Google Drive token revoke failed; continuing with local delete', {
          error: String(error),
        })
      })
    }
    await this.connectionRepository.deleteByUser(params)
  }

  async listFolders(params: UserScope & { parentId: string }): Promise<DriveFolder[]> {
    const accessToken = await this.getFreshAccessToken(params)
    return this.driveApi.listFolders({
      accessToken,
      parentId: params.parentId || googleDriveLimits.rootFolderId,
    })
  }

  async listFiles(params: UserScope & { parentId: string }): Promise<DriveFile[]> {
    const accessToken = await this.getFreshAccessToken(params)
    return this.driveApi.listFiles({
      accessToken,
      parentId: params.parentId || googleDriveLimits.rootFolderId,
    })
  }

  async uploadBytes(
    params: UserScope & {
      folderId: string
      folderName: string
      fileName: string
      mimeType: string
      bytes: Uint8Array
    }
  ): Promise<DriveUploadResult> {
    const accessToken = await this.getFreshAccessToken(params)
    const result = await this.driveApi.uploadFile({
      accessToken,
      folderId: params.folderId,
      fileName: params.fileName,
      mimeType: params.mimeType,
      bytes: params.bytes,
    })

    // Remember the destination folder for next time (best-effort).
    await this.connectionRepository
      .updateLastFolder({
        tenantId: params.tenantId,
        userId: params.userId,
        lastFolderId: params.folderId,
        lastFolderName: params.folderName,
      })
      .catch((error) => {
        this.logger.warn('Failed to persist last Drive folder', { error: String(error) })
      })

    return result
  }

  async importFile(params: UserScope & { fileId: string }): Promise<DriveImportedFile> {
    const accessToken = await this.getFreshAccessToken(params)
    const [metadata, bytes] = await Promise.all([
      this.driveApi.getFileMetadata({ accessToken, fileId: params.fileId }),
      this.driveApi.downloadFile({ accessToken, fileId: params.fileId }),
    ])
    return { fileName: metadata.name, mimeType: metadata.mimeType, bytes }
  }

  /**
   * Returns a valid access token, refreshing (and persisting the new token) when
   * the cached one is missing or within the refresh skew of expiry. A failed
   * refresh means the refresh token was revoked/expired → the connection is
   * dropped and the caller is told to reconnect.
   */
  private async getFreshAccessToken(params: UserScope): Promise<string> {
    const connection = await this.connectionRepository.findByUser(params)
    if (!connection) {
      throw new BusinessRuleError(
        googleDriveErrorCodes.notConnected,
        'Google Drive is not connected. Please connect your account first.'
      )
    }

    const skewMs = googleDriveOauth.accessTokenRefreshSkewSeconds * 1000
    const expiresAtMs = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0
    if (connection.accessToken && Number.isFinite(expiresAtMs) && Date.now() < expiresAtMs - skewMs) {
      return connection.accessToken
    }

    try {
      const tokenSet = await this.oauthClient.refreshAccessToken({ refreshToken: connection.refreshToken })
      await this.connectionRepository.updateTokens({
        tenantId: params.tenantId,
        userId: params.userId,
        accessToken: tokenSet.accessToken,
        tokenExpiresAt: this.computeExpiry(tokenSet.expiresInSeconds),
        refreshToken: tokenSet.refreshToken,
      })
      return tokenSet.accessToken
    } catch (error) {
      this.logger.warn('Google Drive token refresh failed; dropping connection', {
        tenantId: params.tenantId,
        userId: params.userId,
        error: String(error),
      })
      await this.connectionRepository.deleteByUser(params).catch(() => {})
      throw new BusinessRuleError(
        googleDriveErrorCodes.authExpired,
        'Your Google Drive session expired. Please reconnect your account.'
      )
    }
  }

  private computeExpiry(expiresInSeconds: number): string {
    return new Date(Date.now() + Math.max(60, expiresInSeconds) * 1000).toISOString()
  }
}
