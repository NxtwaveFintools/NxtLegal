import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  googleDriveEndpoints,
  googleDriveErrorCodes,
  googleDriveFolderMimeType,
  googleDriveLimits,
  googleDriveServiceName,
} from '@/core/constants/google-drive'
import { AuthorizationError, BusinessRuleError, ExternalServiceError, NotFoundError } from '@/core/http/errors'
import type { DriveApiRepository } from '@/core/domain/drive/drive-api-repository'
import type { DriveFile, DriveFileMetadata, DriveFolder, DriveUploadResult } from '@/core/domain/drive/types'

type GoogleErrorResponse = {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string }> }
}

/** Google Drive REST API v3 client. Each method takes an already-valid access token. */
export class GoogleDriveApiClient implements DriveApiRepository {
  async listFolders(params: { accessToken: string; parentId: string }): Promise<DriveFolder[]> {
    const escapedParent = params.parentId.replace(/'/g, "\\'")
    const query = new URLSearchParams({
      q: `'${escapedParent}' in parents and mimeType = '${googleDriveFolderMimeType}' and trashed = false`,
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: String(googleDriveLimits.folderPageSize),
      spaces: 'drive',
    })

    const payload = (await this.fetchJson(
      `${googleDriveEndpoints.files}?${query.toString()}`,
      { headers: this.authHeaders(params.accessToken) },
      'list'
    )) as { files?: Array<{ id?: string; name?: string }> }

    return (payload.files ?? [])
      .filter((file): file is { id: string; name: string } => Boolean(file.id && file.name))
      .map((file) => ({ id: file.id, name: file.name }))
  }

  async listFiles(params: { accessToken: string; parentId: string }): Promise<DriveFile[]> {
    const escapedParent = params.parentId.replace(/'/g, "\\'")
    const query = new URLSearchParams({
      q: `'${escapedParent}' in parents and mimeType != '${googleDriveFolderMimeType}' and trashed = false`,
      fields: 'files(id,name,mimeType)',
      orderBy: 'name',
      pageSize: String(googleDriveLimits.folderPageSize),
      spaces: 'drive',
    })

    const payload = (await this.fetchJson(
      `${googleDriveEndpoints.files}?${query.toString()}`,
      { headers: this.authHeaders(params.accessToken) },
      'listFiles'
    )) as { files?: Array<{ id?: string; name?: string; mimeType?: string }> }

    return (payload.files ?? [])
      .filter((file): file is { id: string; name: string; mimeType?: string } => Boolean(file.id && file.name))
      .map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType ?? 'application/octet-stream' }))
  }

  async uploadFile(params: {
    accessToken: string
    folderId: string
    fileName: string
    mimeType: string
    bytes: Uint8Array
  }): Promise<DriveUploadResult> {
    const boundary = `nxtlegal-${randomUUID()}`
    const metadata = JSON.stringify({ name: params.fileName, parents: [params.folderId] })
    const preamble =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${params.mimeType}\r\n\r\n`
    const epilogue = `\r\n--${boundary}--`
    const body = Buffer.concat([
      Buffer.from(preamble, 'utf8'),
      Buffer.from(params.bytes),
      Buffer.from(epilogue, 'utf8'),
    ])

    const query = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name,webViewLink' })
    const payload = (await this.fetchJson(
      `${googleDriveEndpoints.upload}?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          ...this.authHeaders(params.accessToken),
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
      'upload'
    )) as { id?: string; name?: string; webViewLink?: string }

    if (!payload.id) {
      throw new ExternalServiceError(
        googleDriveServiceName,
        'Google Drive upload response missing file id',
        undefined,
        {
          code: googleDriveErrorCodes.uploadFailed,
        }
      )
    }

    return {
      fileId: payload.id,
      fileName: payload.name ?? params.fileName,
      folderId: params.folderId,
      webViewLink: payload.webViewLink ?? null,
    }
  }

  async getFileMetadata(params: { accessToken: string; fileId: string }): Promise<DriveFileMetadata> {
    const query = new URLSearchParams({ fields: 'id,name,mimeType,size' })
    const payload = (await this.fetchJson(
      `${googleDriveEndpoints.files}/${params.fileId}?${query.toString()}`,
      { headers: this.authHeaders(params.accessToken) },
      'metadata'
    )) as { id?: string; name?: string; mimeType?: string; size?: string }

    return {
      id: payload.id ?? params.fileId,
      name: payload.name ?? 'drive-file',
      mimeType: payload.mimeType ?? 'application/octet-stream',
      sizeBytes: payload.size ? Number(payload.size) : null,
    }
  }

  async downloadFile(params: { accessToken: string; fileId: string }): Promise<Uint8Array> {
    const query = new URLSearchParams({ alt: 'media' })
    const url = `${googleDriveEndpoints.files}/${params.fileId}?${query.toString()}`

    let response: Response
    try {
      response = await fetch(url, { headers: this.authHeaders(params.accessToken) })
    } catch (error) {
      throw new ExternalServiceError(
        googleDriveServiceName,
        'Network error downloading from Google Drive',
        error instanceof Error ? error : undefined,
        { code: googleDriveErrorCodes.networkError }
      )
    }

    if (!response.ok) {
      throw this.mapError(await response.text(), response.status, 'download')
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  async getAccountEmail(params: { accessToken: string }): Promise<string | null> {
    const query = new URLSearchParams({ fields: 'user(emailAddress)' })
    const payload = (await this.fetchJson(
      `${googleDriveEndpoints.about}?${query.toString()}`,
      { headers: this.authHeaders(params.accessToken) },
      'about'
    )) as { user?: { emailAddress?: string } }

    return payload.user?.emailAddress ?? null
  }

  private authHeaders(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` }
  }

  private async fetchJson(url: string, init: RequestInit, operation: string): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      throw new ExternalServiceError(
        googleDriveServiceName,
        'Network error contacting Google Drive',
        error instanceof Error ? error : undefined,
        { code: googleDriveErrorCodes.networkError, operation }
      )
    }

    if (!response.ok) {
      throw this.mapError(await response.text(), response.status, operation)
    }

    return response.json()
  }

  /**
   * Maps Google API HTTP failures to domain errors.
   * NOTE: a Drive 401 becomes a 422 (BusinessRuleError) — never a 401 — so the
   * frontend api-client does not mistake it for an expired app session.
   */
  private mapError(body: string, status: number, operation: string): Error {
    let reason = ''
    let message = body
    try {
      const parsed = JSON.parse(body) as GoogleErrorResponse
      reason = parsed.error?.errors?.[0]?.reason ?? ''
      message = parsed.error?.message ?? body
    } catch {
      // body was not JSON; keep raw text.
    }

    if (status === 401) {
      return new BusinessRuleError(
        googleDriveErrorCodes.authExpired,
        'Your Google Drive session expired. Please reconnect your account.'
      )
    }

    if (status === 403) {
      if (reason === 'storageQuotaExceeded') {
        return new BusinessRuleError(
          googleDriveErrorCodes.insufficientStorage,
          'Your Google Drive is out of storage space. Free up space and try again.'
        )
      }
      return new AuthorizationError(
        googleDriveErrorCodes.permissionDenied,
        'Google Drive denied permission for this action.'
      )
    }

    if (status === 404) {
      return new NotFoundError('Google Drive file')
    }

    return new ExternalServiceError(googleDriveServiceName, `Google Drive ${operation} failed: ${message}`)
  }
}
