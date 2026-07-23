import { contractWorkflowRoles } from '@/core/constants/contracts'

/**
 * Google Drive integration constants.
 *
 * Scopes:
 * - drive.file     → create/upload files the app owns (export/push to Drive)
 * - drive.readonly → browse the user's folder tree AND download file content
 *                    (import/pull into the signing workflow)
 */
export const googleDriveScopes = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
] as const

export const googleDriveEndpoints = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  files: 'https://www.googleapis.com/drive/v3/files',
  upload: 'https://www.googleapis.com/upload/drive/v3/files',
  about: 'https://www.googleapis.com/drive/v3/about',
} as const

export const googleDriveFolderMimeType = 'application/vnd.google-apps.folder'

export const googleDriveOauth = {
  accessType: 'offline',
  // select_account lets the user choose/switch which Google account to connect;
  // consent ensures Google returns a refresh token for offline access.
  prompt: 'select_account consent',
  responseType: 'code',
  grantTypeAuthorizationCode: 'authorization_code',
  grantTypeRefreshToken: 'refresh_token',
  /** How long the signed OAuth state (and its paired nonce cookie) stays valid. */
  stateTtlSeconds: 60 * 10,
  /** Refresh the access token this many seconds before its real expiry. */
  accessTokenRefreshSkewSeconds: 60,
} as const

export const googleDriveLimits = {
  folderPageSize: 200,
  rootFolderId: 'root',
} as const

/** Roles allowed to IMPORT files from Drive into the signing workflow. */
export const googleDriveImportAllowedRoles = [contractWorkflowRoles.legalTeam, contractWorkflowRoles.admin] as const

/** Domain error codes surfaced to the client with friendly messages. */
export const googleDriveErrorCodes = {
  featureDisabled: 'DRIVE_FEATURE_DISABLED',
  configMissing: 'DRIVE_CONFIG_MISSING',
  notConnected: 'DRIVE_NOT_CONNECTED',
  authExpired: 'DRIVE_AUTH_EXPIRED',
  permissionDenied: 'DRIVE_PERMISSION_DENIED',
  insufficientStorage: 'DRIVE_INSUFFICIENT_STORAGE',
  networkError: 'DRIVE_NETWORK_ERROR',
  uploadFailed: 'DRIVE_UPLOAD_FAILED',
  listFailed: 'DRIVE_LIST_FAILED',
  importFailed: 'DRIVE_IMPORT_FAILED',
  invalidState: 'DRIVE_INVALID_STATE',
  importForbidden: 'DRIVE_IMPORT_FORBIDDEN',
} as const

export type GoogleDriveErrorCode = (typeof googleDriveErrorCodes)[keyof typeof googleDriveErrorCodes]

/** Service name used in ExternalServiceError + structured logs. */
export const googleDriveServiceName = 'GOOGLE_DRIVE'

/** Postgres table backing per-user Drive connections. */
export const googleDriveConnectionsTable = 'google_drive_connections'
