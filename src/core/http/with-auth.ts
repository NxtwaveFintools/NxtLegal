import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/core/infra/session/jwt-session-store'
import { errorResponse } from '@/core/http/response'
import { authErrorCodes, authErrorMessages } from '@/core/constants/auth-errors'
import { logger } from '@/core/infra/logging/logger'
import type { SessionData } from '@/core/infra/session/jwt-session-store'

type AuthenticatedHandler<T = unknown> = (
  request: NextRequest,
  context: { params?: Record<string, string>; session: SessionData }
) => Promise<NextResponse<T>>

type RouteHandlerContext = {
  params?: Record<string, string> | Promise<Record<string, string>>
}

/**
 * Higher-Order Function (Proxy Pattern) for protecting API routes.
 *
 * Security guarantees are provided by getSession(), which already:
 *  1. Validates the JWT cryptographic signature and expiry.
 *  2. Checks in-memory token revocation (revokedTokensCache).
 *  3. Queries the database for the current token_version, is_active, and
 *     deleted_at — rejecting sessions whose token version no longer matches
 *     or whose principal has been deactivated/deleted.
 *
 * A second DB lookup here (findByEmployeeId) would duplicate all three
 * checks above and inflate per-request latency by an extra round-trip for
 * every parallel API call on a single page load.
 *
 * @example
 * export const GET = withAuth(async (request, { session }) => {
 *   // session is guaranteed to be valid
 *   return NextResponse.json({ user: session.employeeId })
 * })
 */
export function withAuth<T = unknown>(handler: AuthenticatedHandler<T>) {
  return async (request: NextRequest, context: RouteHandlerContext = {}) => {
    try {
      const session = await getSession()
      const resolvedParams = context.params ? await Promise.resolve(context.params) : undefined

      if (!session || !session.employeeId) {
        logger.warn('Unauthorized API access attempt', {
          path: request.nextUrl.pathname,
          method: request.method,
        })

        return NextResponse.json(
          errorResponse(authErrorCodes.unauthorized, authErrorMessages[authErrorCodes.unauthorized]),
          { status: 401 }
        )
      }

      if (!session.tenantId) {
        logger.warn('Session missing tenant identifier during auth proxy', {
          path: request.nextUrl.pathname,
          employeeId: session.employeeId,
        })

        return NextResponse.json(
          errorResponse(authErrorCodes.unauthorized, authErrorMessages[authErrorCodes.unauthorized]),
          { status: 401 }
        )
      }

      // session already carries role, email, fullName, and tokenVersion from the
      // verified JWT payload — no additional DB hydration required.
      return await handler(request, { params: resolvedParams, session })
    } catch (error) {
      logger.error('Auth proxy error', {
        path: request.nextUrl.pathname,
        error: String(error),
      })

      return NextResponse.json(errorResponse(authErrorCodes.authFailed, authErrorMessages[authErrorCodes.authFailed]), {
        status: 500,
      })
    }
  }
}

/**
 * Proxy wrapper for public routes (no auth required, but session available if exists)
 */
export function withOptionalAuth<T = unknown>(handler: AuthenticatedHandler<T>) {
  return async (request: NextRequest, context: RouteHandlerContext = {}) => {
    const session = await getSession()
    const resolvedParams = context.params ? await Promise.resolve(context.params) : undefined

    return await handler(request, {
      params: resolvedParams,
      session: session || { employeeId: '', email: undefined, fullName: undefined },
    })
  }
}
