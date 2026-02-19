import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractUploadService } from '@/core/registry/service-registry'
import { logger } from '@/core/infra/logging/logger'

const GETHandler = withAuth(async (_request: NextRequest, { session, params }) => {
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    if (!session.role) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session role is required'), { status: 401 })
    }

    const contractId = params?.contractId

    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    const contractUploadService = getContractUploadService()
    const result = await contractUploadService.createSignedDownloadUrl({
      contractId,
      tenantId: session.tenantId,
      requestorEmployeeId: session.employeeId,
      requestorRole: session.role,
    })

    return NextResponse.json(
      okResponse({
        contractId,
        fileName: result.fileName,
        signedUrl: result.signedUrl,
      })
    )
  } catch (error) {
    logger.warn('Contract download URL generation failed', {
      error: String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    })

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to generate contract download URL'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
