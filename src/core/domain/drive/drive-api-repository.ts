import type { DriveFile, DriveFileMetadata, DriveFolder, DriveUploadResult } from './types'

/**
 * Google Drive REST API abstraction. Implemented in infrastructure.
 * Every method receives an already-valid access token — token lifecycle is the
 * DriveService's responsibility, not this repository's.
 */
export interface DriveApiRepository {
  listFolders(params: { accessToken: string; parentId: string }): Promise<DriveFolder[]>
  listFiles(params: { accessToken: string; parentId: string }): Promise<DriveFile[]>
  uploadFile(params: {
    accessToken: string
    folderId: string
    fileName: string
    mimeType: string
    bytes: Uint8Array
  }): Promise<DriveUploadResult>
  getFileMetadata(params: { accessToken: string; fileId: string }): Promise<DriveFileMetadata>
  downloadFile(params: { accessToken: string; fileId: string }): Promise<Uint8Array>
  getAccountEmail(params: { accessToken: string }): Promise<string | null>
}
