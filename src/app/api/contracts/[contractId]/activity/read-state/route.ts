import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractQueryService } from '@/core/registry/service-registry'
import { contractActivityReadStateSchema } from '@/core/domain/contracts/schemas'

const PATCHHandler = withAuth(async (request: NextRequest, { session, params }) => {
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    const contractId = params?.contractId
    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    contractActivityReadStateSchema.parse(await request.json())

    const contractQueryService = getContractQueryService()
    const readState = await contractQueryService.markContractActivitySeen({
      tenantId: session.tenantId,
      contractId,
      employeeId: session.employeeId,
      role: session.role,
    })

    return NextResponse.json(okResponse(readState))
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'Invalid activity read-state payload'), {
        status: 400,
      })
    }

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to update activity read state'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const PATCH = PATCHHandler
