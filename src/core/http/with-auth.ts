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
 * Higher-Order Function (Proxy Pattern) for protecting API routes
 *
 * @example
 * export const GET = withAuth(async (request, { session }) => {
 *   // session is guaranteed to exist
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

      // Pass validated session to handler
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
