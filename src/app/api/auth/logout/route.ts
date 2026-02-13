import { NextResponse, type NextRequest } from 'next/server'
import { getAuthService } from '@/core/registry/service-registry'
import { withCorrelationId } from '@/core/http/with-correlation-id'
import { errorResponse, okResponse } from '@/core/http/response'
import { authErrorCodes, authErrorMessages } from '@/core/constants/auth-errors'
import { logger } from '@/core/infra/logging/logger'

const handleLogout = async (request: NextRequest, correlationId: string) => {
  try {
    const authService = getAuthService()
    await authService.logout()

    logger.info('User logged out successfully', { correlationId })
    return NextResponse.json(okResponse({ success: true }))
  } catch (error) {
    logger.error('Logout failed', { correlationId, error: String(error) })
    return NextResponse.json(
      errorResponse(authErrorCodes.authFailed, authErrorMessages[authErrorCodes.authFailed], { correlationId }),
      {
        status: 500,
        headers: {
          'X-Correlation-ID': correlationId,
        },
      }
    )
  }
}

export const POST = withCorrelationId(handleLogout)
