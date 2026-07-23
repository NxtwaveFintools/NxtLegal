import { NextRequest } from 'next/server'
import { getSession } from '@/core/infra/session/jwt-session-store'
import { cookieNames } from '@/core/constants/cookies'
import { getErrorMessage, isAppError } from '@/core/http/errors'
import { logger } from '@/core/infra/logging/logger'
import { getDriveService } from '@/core/registry/service-registry'
import { verifyDriveOAuthState } from '@/core/infra/integrations/google-drive/drive-oauth-state'
import {
  driveConnectedHtml,
  getDriveRedirectUri,
  isGoogleDriveEnabled,
} from '@/core/infra/integrations/google-drive/drive-http'

/**
 * OAuth callback. Bare GET (OAuth redirects can't carry our session cookie through
 * `withAuth` cleanly), so it validates the signed state + paired nonce cookie AND
 * re-checks the live app session before persisting the connection. Renders an HTML
 * page that closes the OAuth popup.
 */
export async function GET(request: NextRequest) {
  if (!isGoogleDriveEnabled()) {
    return driveConnectedHtml({ ok: false, message: 'Google Drive integration is disabled.' })
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error')
  const stateParam = url.searchParams.get('state')

  if (oauthError) {
    return driveConnectedHtml({ ok: false, message: 'Google Drive authorization was cancelled.' })
  }
  if (!code || !stateParam) {
    return driveConnectedHtml({ ok: false, message: 'Invalid authorization response from Google.' })
  }

  const state = await verifyDriveOAuthState(stateParam)
  const nonceCookie = request.cookies.get(cookieNames.driveOauthState)?.value
  if (!state || !nonceCookie || nonceCookie !== state.nonce) {
    return driveConnectedHtml({ ok: false, message: 'Authorization session expired. Please try connecting again.' })
  }

  const session = await getSession()
  if (!session || session.employeeId !== state.userId || session.tenantId !== state.tenantId) {
    return driveConnectedHtml({ ok: false, message: 'Your session did not match. Please sign in and try again.' })
  }

  try {
    await getDriveService().completeAuthorization({
      tenantId: state.tenantId,
      userId: state.userId,
      code,
      redirectUri: getDriveRedirectUri(),
    })

    const response = driveConnectedHtml({ ok: true, message: 'Google Drive connected. You can close this window.' })
    response.cookies.delete(cookieNames.driveOauthState)
    return response
  } catch (error) {
    logger.error('Google Drive OAuth callback failed', { error: getErrorMessage(error) })
    const message = isAppError(error) ? error.message : 'Failed to connect Google Drive. Please try again.'
    return driveConnectedHtml({ ok: false, message })
  }
}
