import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { okResponse } from '@/core/http/response'
import { appConfig } from '@/core/config/app-config'
import { routeRegistry } from '@/core/config/route-registry'
import { cookieNames } from '@/core/constants/cookies'
import { googleDriveOauth } from '@/core/constants/google-drive'
import { getDriveService } from '@/core/registry/service-registry'
import { createDriveOAuthState } from '@/core/infra/integrations/google-drive/drive-oauth-state'
import {
  driveErrorResponse,
  driveFeatureDisabledResponse,
  getDriveRedirectUri,
  isGoogleDriveEnabled,
  requireSessionScope,
  resolveSafeReturnPath,
} from '@/core/infra/integrations/google-drive/drive-http'

/** Returns the Google authorization URL and sets a paired CSRF nonce cookie. */
export const GET = withAuth(async (request, { session }) => {
  if (!isGoogleDriveEnabled()) {
    return driveFeatureDisabledResponse()
  }

  try {
    const { tenantId, userId } = requireSessionScope(session)
    const returnPath = resolveSafeReturnPath(request) ?? routeRegistry.protected.dashboard
    const nonce = randomUUID()
    const state = await createDriveOAuthState({ userId, tenantId, nonce, returnPath })
    const authorizationUrl = getDriveService().buildAuthorizationUrl({
      state,
      redirectUri: getDriveRedirectUri(request),
    })

    const response = NextResponse.json(okResponse({ authorizationUrl }))
    response.cookies.set(cookieNames.driveOauthState, nonce, {
      httpOnly: true,
      secure: appConfig.environment === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: googleDriveOauth.stateTtlSeconds,
    })
    return response
  } catch (error) {
    return driveErrorResponse(error, { route: 'drive/connect', userId: session.employeeId })
  }
})
