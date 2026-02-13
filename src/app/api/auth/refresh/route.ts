import { NextResponse, type NextRequest } from 'next/server'
import { refreshSession } from '@/core/infra/session/jwt-session-store'
import { withCorrelationId } from '@/core/http/with-correlation-id'
import { errorResponse, okResponse } from '@/core/http/response'
import { authErrorCodes, authErrorMessages } from '@/core/constants/auth-errors'
import { rateLimiter } from '@/core/infra/rate-limiting/simple-rate-limiter'
import { logger } from '@/core/infra/logging/logger'

const handleRefresh = async (request: NextRequest, correlationId: string) => {
  try {
    // Get IP address for rate limiting
    const ip = request.headers.get('x-forwarded-for') || 'unknown'

    // Extract tenant ID from request (for future multi-tenant validation)
    // TODO: Validate incoming tenant ID matches JWT tenant claim
    // const tenantId = request.headers.get('X-Tenant-ID') || '00000000-0000-0000-0000-000000000000'

    // Rate limit: 10 attempts per minute per IP
    const rateLimitKey = `ratelimit:refresh:${ip}`
    const { allowed, resetAfterSeconds } = rateLimiter.checkLimit(rateLimitKey, 10, 60)

    if (!allowed) {
      logger.warn('Refresh rate limit exceeded', { correlationId, ip })
      return NextResponse.json(
        errorResponse(
          authErrorCodes.rateLimitExceeded,
          authErrorMessages[authErrorCodes.rateLimitExceeded] ?? 'Too many refresh attempts. Please try again later.',
          { correlationId }
        ),
        {
          status: 429,
          headers: {
            'Retry-After': String(resetAfterSeconds),
            'X-Correlation-ID': correlationId,
          },
        }
      )
    }

    const session = await refreshSession()

    if (!session) {
      logger.warn('Session refresh failed - no valid session', { correlationId })
      return NextResponse.json(
        errorResponse(authErrorCodes.unauthorized, 'Session expired. Please login again.', { correlationId }),
        {
          status: 401,
          headers: {
            'X-Correlation-ID': correlationId,
          },
        }
      )
    }

    logger.info('Session refreshed successfully', { correlationId, employeeId: session.employeeId })
    return NextResponse.json(okResponse({ session }))
  } catch (error) {
    logger.error('Refresh endpoint error', { correlationId, error: String(error) })
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

export const POST = withCorrelationId(handleRefresh)
