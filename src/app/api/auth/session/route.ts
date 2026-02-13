import { NextResponse, type NextRequest } from 'next/server'
import { getAuthService } from '@/core/registry/service-registry'
import { withCorrelationId } from '@/core/http/with-correlation-id'
import { okResponse } from '@/core/http/response'
import { logger } from '@/core/infra/logging/logger'

const handleSession = async (request: NextRequest, correlationId: string) => {
  try {
    const authService = getAuthService()
    const session = await authService.getSession()

    if (!session) {
      return NextResponse.json(okResponse({ authenticated: false }))
    }

    logger.info('Session retrieved', { correlationId, employeeId: session.employeeId })
    return NextResponse.json(okResponse({ authenticated: true, employee: session }))
  } catch (error) {
    logger.warn('Session retrieval failed', { correlationId, error: String(error) })
    return NextResponse.json(okResponse({ authenticated: false }))
  }
}

export const GET = withCorrelationId(handleSession)
