import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractQueryService } from '@/core/registry/service-registry'

const GETHandler = withAuth(async (request: NextRequest, { session, params }) => {
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    const tenantId = session.tenantId

    const contractId = params?.contractId

    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    const limit = Number(request.nextUrl.searchParams.get('limit') ?? '20')

    const contractQueryService = getContractQueryService()
    const events = await contractQueryService.getContractTimeline({
      tenantId,
      contractId,
      employeeId: session.employeeId,
      role: session.role,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20,
    })

    return NextResponse.json(okResponse({ events }))
  } catch (error) {
    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to fetch contract timeline'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
