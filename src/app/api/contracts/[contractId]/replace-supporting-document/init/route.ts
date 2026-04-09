import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { getContractUploadService, getIdempotencyService } from '@/core/registry/service-registry'
import { isAppError } from '@/core/http/errors'
import { logger } from '@/core/infra/logging/logger'

export const maxDuration = 300

const requestSchema = z.object({
  documentId: z.string().trim().uuid('Valid documentId is required'),
  file: z.object({
    fileName: z.string().trim().min(1, 'File name is required'),
    fileSizeBytes: z.number().int().positive('File size must be greater than zero'),
    fileMimeType: z.string().trim().min(1, 'File MIME type is required'),
  }),
})

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

    const payload = await request.json()
    const parsedPayload = requestSchema.safeParse(payload)
    if (!parsedPayload.success) {
      return NextResponse.json(
        errorResponse('VALIDATION_ERROR', parsedPayload.error.issues[0]?.message ?? 'Invalid input'),
        { status: 400 }
      )
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
    const plan = await contractUploadService.initiateReplaceSupportingDocument({
      tenantId: session.tenantId,
      contractId,
      sourceDocumentId: parsedPayload.data.documentId,
      uploadedByEmployeeId: session.employeeId,
      uploadedByEmail: session.email,
      uploadedByRole: session.role,
      fileName: parsedPayload.data.file.fileName,
      fileSizeBytes: parsedPayload.data.file.fileSizeBytes,
      fileMimeType: parsedPayload.data.file.fileMimeType,
    })

    const responseData = okResponse(plan)
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
    logger.warn('Supporting document replacement init failed', {
      error: String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    })
    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to initialize supporting document replacement'
    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const POST = POSTHandler
