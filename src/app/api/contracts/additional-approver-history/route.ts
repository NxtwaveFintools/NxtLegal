import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractQueryService } from '@/core/registry/service-registry'
import { additionalApproverHistoryQuerySchema } from '@/core/domain/contracts/schemas'
import { supabaseEmployeeRepository } from '@/core/infra/repositories/supabase-employee-repository'

const adminHistoryRoles = new Set(['ADMIN', 'LEGAL_ADMIN', 'SUPER_ADMIN'])

const GETHandler = withAuth(async (request: NextRequest, { session }) => {
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const { cursor, limit, departmentId } = additionalApproverHistoryQuerySchema.parse(queryParams)

    const normalizedRole = (session.role ?? '').toUpperCase()
    const isAdminRole = adminHistoryRoles.has(normalizedRole)

    if (!isAdminRole && departmentId) {
      return NextResponse.json(errorResponse('FORBIDDEN', 'Department filter is allowed only for admin users'), {
        status: 403,
      })
    }

    const hasAdditionalApproverParticipation = await supabaseEmployeeRepository.hasAdditionalApproverParticipation({
      email: session.email ?? '',
      tenantId: session.tenantId,
    })

    if (!isAdminRole && !hasAdditionalApproverParticipation) {
      return NextResponse.json(
        errorResponse('FORBIDDEN', 'You are not allowed to access additional approver history'),
        {
          status: 403,
        }
      )
    }

    const contractQueryService = getContractQueryService()
    const result = await contractQueryService.getAdditionalApproverDecisionHistory({
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      role: session.role,
      cursor,
      limit,
      departmentId: isAdminRole ? departmentId : undefined,
    })

    return NextResponse.json(
      okResponse({
        history: result.items,
        pagination: {
          cursor: result.nextCursor ?? null,
          limit,
          total: result.total,
        },
      })
    )
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'Invalid additional approver history query params'), {
        status: 400,
      })
    }

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to list additional approver history'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
