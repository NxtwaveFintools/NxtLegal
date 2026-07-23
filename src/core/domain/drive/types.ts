/**
 * Google Drive domain types. Pure — no infrastructure imports.
 */

/** A per-user Drive connection as the domain sees it (tokens already decrypted). */
export type DriveConnection = {
  id: string
  tenantId: string
  userId: string
  googleAccountEmail: string | null
  accessToken: string | null
  refreshToken: string
  tokenExpiresAt: string | null
  scope: string | null
  lastFolderId: string | null
  lastFolderName: string | null
}

/** Fields required to create/replace a connection after an OAuth exchange. */
export type DriveConnectionUpsert = {
  tenantId: string
  userId: string
  googleAccountEmail: string | null
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
  scope: string
}

/** Public connection status returned to the client (never exposes tokens). */
export type DriveConnectionStatus = {
  connected: boolean
  googleAccountEmail: string | null
  lastFolder: { id: string; name: string } | null
}

export type DriveFolder = {
  id: string
  name: string
}

export type DriveFile = {
  id: string
  name: string
  mimeType: string
}

export type DriveFileMetadata = {
  id: string
  name: string
  mimeType: string
  sizeBytes: number | null
}

export type DriveUploadResult = {
  fileId: string
  fileName: string
  folderId: string
  webViewLink: string | null
}

/** Normalised token payload returned by the OAuth client. */
export type DriveTokenSet = {
  accessToken: string
  /** Present on the initial authorization-code exchange; usually absent on refresh. */
  refreshToken?: string
  expiresInSeconds: number
  scope: string
}

/** A file fetched from Drive for import into the portal. */
export type DriveImportedFile = {
  fileName: string
  mimeType: string
  bytes: Uint8Array
}
