import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractUploadService, getIdempotencyService } from '@/core/registry/service-registry'
import { logger } from '@/core/infra/logging/logger'

export const maxDuration = 300

const POSTHandler = withAuth(async (request: NextRequest, { session, params }) => {
  let shouldReleaseClaim = false

  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    if (!session.email || !session.role) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session is missing required user details'), {
        status: 401,
      })
    }

    const contractId = params?.contractId
    if (!contractId || typeof contractId !== 'string') {
      return NextResponse.json(errorResponse('CONTRACT_ID_REQUIRED', 'Contract ID is required'), { status: 400 })
    }

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
    if (!idempotencyKey) {
      return NextResponse.json(errorResponse('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required'), {
        status: 400,
      })
    }

    const formData = await request.formData()
    const uploadedFile = formData.get('file')
    const sourceDocumentId = formData.get('documentId')

    if (!(uploadedFile instanceof File)) {
      return NextResponse.json(errorResponse('CONTRACT_FILE_REQUIRED', 'A file is required for replacement'), {
        status: 400,
      })
    }

    if (typeof sourceDocumentId !== 'string' || !sourceDocumentId.trim()) {
      return NextResponse.json(errorResponse('DOCUMENT_ID_REQUIRED', 'Document ID is required'), { status: 400 })
    }

    const idempotencyService = getIdempotencyService()
    const claimResult = await idempotencyService.claimOrGet(idempotencyKey, session.tenantId)
    if (claimResult.status === 'cached') {
      return NextResponse.json(claimResult.record.responseData, { status: claimResult.record.statusCode })
    }

    if (claimResult.status === 'in-progress') {
      return NextResponse.json(
        errorResponse('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is already in progress'),
        { status: 409 }
      )
    }

    shouldReleaseClaim = true

    const contractUploadService = getContractUploadService()
    await contractUploadService.replaceSupportingDocument({
      tenantId: session.tenantId,
      contractId,
      sourceDocumentId: sourceDocumentId.trim(),
      uploadedByEmployeeId: session.employeeId,
      uploadedByEmail: session.email,
      uploadedByRole: session.role,
      fileName: uploadedFile.name,
      fileSizeBytes: uploadedFile.size,
      fileMimeType: uploadedFile.type || 'application/octet-stream',
      fileBody: uploadedFile as Blob,
    })

    logger.info('Supporting contract document replaced successfully', {
      tenantId: session.tenantId,
      contractId,
      sourceDocumentId: sourceDocumentId.trim(),
      userId: session.employeeId,
      role: session.role,
    })

    const responseData = okResponse({
      success: true as const,
    })

    await idempotencyService.store(idempotencyKey, session.tenantId, responseData, 200)
    shouldReleaseClaim = false

    return NextResponse.json(responseData)
  } catch (error) {
    const tenantId = session.tenantId
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
    if (tenantId && idempotencyKey && shouldReleaseClaim) {
      try {
        const idempotencyService = getIdempotencyService()
        await idempotencyService.releaseClaim(idempotencyKey, tenantId)
      } catch {
        // noop
      }
    }

    logger.warn('Supporting contract document replacement failed', {
      error: String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    })

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to replace supporting contract document'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const POST = POSTHandler
