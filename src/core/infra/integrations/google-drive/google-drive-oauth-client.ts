import 'server-only'

import {
  googleDriveEndpoints,
  googleDriveOauth,
  googleDriveScopes,
  googleDriveServiceName,
} from '@/core/constants/google-drive'
import { ExternalServiceError } from '@/core/http/errors'
import type { DriveOAuthClient } from '@/core/domain/drive/drive-oauth-client'
import type { DriveTokenSet } from '@/core/domain/drive/types'

type GoogleDriveOAuthConfig = {
  clientId: string
  clientSecret: string
}

type GoogleTokenResponse = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

/** Google OAuth 2.0 client (authorization-code + refresh-token grants). */
export class GoogleDriveOAuthClient implements DriveOAuthClient {
  constructor(private readonly config: GoogleDriveOAuthConfig) {}

  buildAuthorizationUrl(params: { state: string; redirectUri: string }): string {
    const query = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: params.redirectUri,
      response_type: googleDriveOauth.responseType,
      scope: googleDriveScopes.join(' '),
      access_type: googleDriveOauth.accessType,
      prompt: googleDriveOauth.prompt,
      include_granted_scopes: 'true',
      state: params.state,
    })
    return `${googleDriveEndpoints.authorize}?${query.toString()}`
  }

  async exchangeAuthorizationCode(params: { code: string; redirectUri: string }): Promise<DriveTokenSet> {
    return this.requestToken(
      new URLSearchParams({
        code: params.code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: params.redirectUri,
        grant_type: googleDriveOauth.grantTypeAuthorizationCode,
      })
    )
  }

  async refreshAccessToken(params: { refreshToken: string }): Promise<DriveTokenSet> {
    return this.requestToken(
      new URLSearchParams({
        refresh_token: params.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: googleDriveOauth.grantTypeRefreshToken,
      })
    )
  }

  async revokeToken(params: { token: string }): Promise<void> {
    try {
      await fetch(`${googleDriveEndpoints.revoke}?token=${encodeURIComponent(params.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    } catch {
      // Revocation is best-effort; local deletion still proceeds.
    }
  }

  private async requestToken(body: URLSearchParams): Promise<DriveTokenSet> {
    let response: Response
    try {
      response = await fetch(googleDriveEndpoints.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
    } catch (error) {
      throw new ExternalServiceError(
        googleDriveServiceName,
        'Failed to reach Google OAuth',
        error instanceof Error ? error : undefined
      )
    }

    if (!response.ok) {
      const errorBody = await response.text()
      throw new ExternalServiceError(googleDriveServiceName, `Google OAuth token request failed: ${errorBody}`)
    }

    const payload = (await response.json()) as GoogleTokenResponse
    if (!payload.access_token) {
      throw new ExternalServiceError(googleDriveServiceName, 'Google OAuth response missing access_token')
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresInSeconds: typeof payload.expires_in === 'number' ? payload.expires_in : 3600,
      scope: payload.scope ?? googleDriveScopes.join(' '),
    }
  }
}
