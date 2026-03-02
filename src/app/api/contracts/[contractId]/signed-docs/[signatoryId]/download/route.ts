import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractSignatoryService } from '@/core/registry/service-registry'
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
    const signatoryId = params?.signatoryId

    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    if (!signatoryId || typeof signatoryId !== 'string') {
      return NextResponse.json(errorResponse('SIGNATORY_ID_REQUIRED', 'Signatory ID is required'), { status: 400 })
    }

    const contractSignatoryService = getContractSignatoryService()
    const result = await contractSignatoryService.downloadSignedDocumentForSignatory({
      tenantId: session.tenantId,
      contractId,
      signatoryId,
      actorEmployeeId: session.employeeId,
      actorRole: session.role,
    })

    const normalizedBytes = new Uint8Array(result.fileBytes)
    const fileBlob = new Blob([normalizedBytes], { type: result.contentType })

    return new NextResponse(fileBlob, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logger.warn('Signatory signed document download failed', {
      error: String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    })

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to download signatory signed document'
    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
