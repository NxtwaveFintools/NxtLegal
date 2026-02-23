import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/core/infra/session/jwt-session-store'
import { errorResponse } from '@/core/http/response'
import { authErrorCodes, authErrorMessages } from '@/core/constants/auth-errors'
import { logger } from '@/core/infra/logging/logger'
import type { SessionData } from '@/core/infra/session/jwt-session-store'
import { supabaseEmployeeRepository } from '@/core/infra/repositories/supabase-employee-repository'

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

      const tenantId = session.tenantId
      if (!tenantId) {
        logger.warn('Session missing tenant identifier during auth proxy', {
          path: request.nextUrl.pathname,
          employeeId: session.employeeId,
        })

        return NextResponse.json(
          errorResponse(authErrorCodes.unauthorized, authErrorMessages[authErrorCodes.unauthorized]),
          { status: 401 }
        )
      }

      const employee = await supabaseEmployeeRepository.findByEmployeeId({
        employeeId: session.employeeId,
        tenantId,
      })

      if (!employee || !employee.isActive) {
        logger.warn('Session principal not found or inactive during auth proxy', {
          path: request.nextUrl.pathname,
          employeeId: session.employeeId,
          tenantId,
        })

        return NextResponse.json(
          errorResponse(authErrorCodes.unauthorized, authErrorMessages[authErrorCodes.unauthorized]),
          { status: 401 }
        )
      }

      const hydratedSession: SessionData = {
        ...session,
        role: employee.role,
        email: employee.email,
        fullName: employee.fullName ?? undefined,
        tokenVersion: employee.tokenVersion,
      }

      // Pass validated session to handler
      return await handler(request, { params: resolvedParams, session: hydratedSession })
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
