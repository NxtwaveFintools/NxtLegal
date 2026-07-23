import { apiClient } from '@/core/client/api-client'
import { routeRegistry } from '@/core/config/route-registry'
import type { ApiResponse } from '@/core/http/response'

const routes = routeRegistry.api.drive

export type DriveConnectionStatus = {
  connected: boolean
  googleAccountEmail: string | null
  lastFolder: { id: string; name: string } | null
}

export type DriveFolder = { id: string; name: string }

export type DriveFile = { id: string; name: string; mimeType: string }

export type DriveExportResult = {
  fileId: string
  fileName: string
  folderId: string
  webViewLink: string | null
}

export type DriveExportInput = {
  contractId: string
  documentId?: string
  artifact?: 'signed_document' | 'completion_certificate' | 'merged_pdf'
  folderId: string
  folderName: string
}

/** Frontend client for the Google Drive integration. Wraps the shared apiClient. */
export const driveClient = {
  getStatus: (): Promise<ApiResponse<DriveConnectionStatus>> => apiClient.get(routes.status),

  getConnectUrl: (returnPath: string): Promise<ApiResponse<{ authorizationUrl: string }>> =>
    apiClient.get(`${routes.connect}?returnPath=${encodeURIComponent(returnPath)}`),

  listFolders: (
    parentId?: string,
    withFiles?: boolean
  ): Promise<ApiResponse<{ parentId: string; folders: DriveFolder[]; files?: DriveFile[] }>> => {
    const params = new URLSearchParams()
    if (parentId) {
      params.set('parentId', parentId)
    }
    if (withFiles) {
      params.set('withFiles', '1')
    }
    const qs = params.toString()
    return apiClient.get(qs ? `${routes.folders}?${qs}` : routes.folders)
  },

  exportDocument: (input: DriveExportInput): Promise<ApiResponse<DriveExportResult>> =>
    apiClient.post(routes.export, input),

  disconnect: (): Promise<ApiResponse<{ disconnected: boolean }>> => apiClient.post(routes.disconnect),

  /**
   * Imports a Drive file into the browser as a File (binary response, not JSON),
   * ready to hand to the existing upload pipeline. LEGAL_TEAM/ADMIN only.
   */
  importFile: async (fileId: string): Promise<File> => {
    const response = await fetch(`${routes.import}?fileId=${encodeURIComponent(fileId)}`, {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      let message = 'Failed to import file from Google Drive'
      try {
        const body = (await response.json()) as { error?: { message?: string } }
        message = body?.error?.message ?? message
      } catch {
        // non-JSON error body; keep default message
      }
      throw new Error(message)
    }

    const headerName = response.headers.get('X-Drive-File-Name')
    const fileName = headerName ? decodeURIComponent(headerName) : 'drive-file'
    const blob = await response.blob()
    return new File([blob], fileName, { type: blob.type || 'application/octet-stream' })
  },
}
