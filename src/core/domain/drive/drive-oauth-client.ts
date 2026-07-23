import type { DriveTokenSet } from './types'

/**
 * Google OAuth 2.0 client abstraction (authorization-code + refresh-token grants).
 * Implemented in infrastructure; injected into DriveService.
 */
export interface DriveOAuthClient {
  buildAuthorizationUrl(params: { state: string; redirectUri: string }): string
  exchangeAuthorizationCode(params: { code: string; redirectUri: string }): Promise<DriveTokenSet>
  refreshAccessToken(params: { refreshToken: string }): Promise<DriveTokenSet>
  revokeToken(params: { token: string }): Promise<void>
}
