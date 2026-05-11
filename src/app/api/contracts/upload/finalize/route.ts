import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse, okResponse } from '@/core/http/response'
import { logger } from '@/core/infra/logging/logger'
import { isAppError } from '@/core/http/errors'
import {
  getContractApprovalNotificationService,
  getContractUploadService,
  getIdempotencyService,
} from '@/core/registry/service-registry'
import {
  uploadContractMetadataSchema,
  resolveUploadContractMetadataInput,
} from '@/app/api/contracts/upload/upload-metadata-payload'

export const maxDuration = 300

const dispatchNotificationSafely = async (
  notification: Promise<unknown>,
  event: string,
  contractId: string
): Promise<void> => {
  try {
    await notification
  } catch (error) {
    logger.warn('Contract upload notification dispatch failed', {
      event,
      contractId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const POSTHandler = withAuth(async (request: NextRequest, { session }) => {
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

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
    if (!idempotencyKey) {
      return NextResponse.json(errorResponse('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required'), {
        status: 400,
      })
    }

    const payload = await request.json()
    const payloadRecordSchema = z.object({
      contractId: z.string().trim().uuid('Valid contractId is required'),
    })
    const parsedMeta = uploadContractMetadataSchema.safeParse(payload)
    if (!parsedMeta.success) {
      return NextResponse.json(
        errorResponse('VALIDATION_ERROR', parsedMeta.error.issues[0]?.message ?? 'Invalid input'),
        {
          status: 400,
        }
      )
    }
    const parsedContract = payloadRecordSchema.safeParse(payload)
    if (!parsedContract.success) {
      return NextResponse.json(
        errorResponse('VALIDATION_ERROR', parsedContract.error.issues[0]?.message ?? 'Invalid input'),
        {
          status: 400,
        }
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

    const input = resolveUploadContractMetadataInput(parsedMeta.data, {
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      email: session.email,
      role: session.role,
    })
    const contractUploadService = getContractUploadService()
    const contract = await contractUploadService.finalizeUploadContract({
      ...input,
      contractId: parsedContract.data.contractId,
    })

    if (!parsedMeta.data.bypassHodApproval) {
      const contractApprovalNotificationService = getContractApprovalNotificationService()
      await dispatchNotificationSafely(
        contractApprovalNotificationService.notifyHodOnContractUpload({
          tenantId: session.tenantId,
          contractId: contract.id,
          actorEmployeeId: session.employeeId,
          actorRole: session.role,
        }),
        'HOD_UPLOAD_NOTIFICATION',
        contract.id
      )
    }

    const responseData = okResponse({
      contract: {
        id: contract.id,
        title: contract.title,
        status: contract.status,
        currentAssigneeEmployeeId: contract.currentAssigneeEmployeeId,
        currentAssigneeEmail: contract.currentAssigneeEmail,
        fileName: contract.fileName,
        fileSizeBytes: contract.fileSizeBytes,
      },
    })

    await idempotencyService.store(idempotencyKey, session.tenantId, responseData, 201)
    shouldReleaseClaim = false
    return NextResponse.json(responseData, { status: 201 })
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

    logger.warn('Contract upload finalize failed', {
      error: String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    })

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to finalize contract upload'
    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const POST = POSTHandler
