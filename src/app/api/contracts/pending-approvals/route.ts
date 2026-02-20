import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractQueryService } from '@/core/registry/service-registry'
import { pendingApprovalsQuerySchema } from '@/core/domain/contracts/schemas'

const GETHandler = withAuth(async (request: NextRequest, { session }) => {
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const { limit } = pendingApprovalsQuerySchema.parse(queryParams)

    const contractQueryService = getContractQueryService()
    const items = await contractQueryService.getPendingApprovalsForRole({
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      role: session.role,
      limit,
    })

    return NextResponse.json(
      okResponse({
        contracts: items,
        pagination: {
          cursor: null,
          limit,
          total: items.length,
        },
      })
    )
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'Invalid pending approvals query params'), {
        status: 400,
      })
    }

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to list pending approvals'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
