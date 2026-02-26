import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { ZodError } from 'zod'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { appConfig } from '@/core/config/app-config'
import { getContractSignatoryService } from '@/core/registry/service-registry'
import { docusignWebhookSchema } from '@/core/domain/contracts/schemas'
import { logger } from '@/core/infra/logging/logger'

const decodeZohoSignature = (signatureHeader: string): Buffer | null => {
  const trimmed = signatureHeader.trim()
  if (!trimmed) {
    return null
  }

  const decoded = Buffer.from(trimmed, 'base64')
  return decoded.length > 0 ? decoded : null
}

const isDigestMatch = (expectedDigest: Buffer, receivedDigest: Buffer): boolean => {
  if (expectedDigest.length !== receivedDigest.length) {
    return false
  }

  return timingSafeEqual(expectedDigest, receivedDigest)
}

export async function POST(request: NextRequest) {
  try {
    const webhookSecret = appConfig.zohoSign.webhookSecret
    if (!webhookSecret) {
      return NextResponse.json(errorResponse('DOCUSIGN_WEBHOOK_DISABLED', 'Zoho Sign webhook is not configured'), {
        status: 503,
      })
    }

    const rawBody = await request.text()
    const receivedSignatureHeader = request.headers.get('x-zs-webhook-signature')
    const receivedSignature = receivedSignatureHeader ? decodeZohoSignature(receivedSignatureHeader) : null
    const expectedDigest = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest()
    const signatureValid = receivedSignature ? isDigestMatch(expectedDigest, receivedSignature) : false

    logger.info('DOCUSIGN_SIGNATURE_VALIDATION_RESULT', {
      signatureValid,
      hasSignatureHeader: Boolean(receivedSignatureHeader),
      signatureHeaderName: 'x-zs-webhook-signature',
    })

    if (!signatureValid) {
      return NextResponse.json(errorResponse('DOCUSIGN_WEBHOOK_FORBIDDEN', 'Invalid webhook signature'), {
        status: 401,
      })
    }

    const rawPayload = JSON.parse(rawBody) as Record<string, unknown>
    const payload = docusignWebhookSchema.parse(rawPayload)
    const contractSignatoryService = getContractSignatoryService()

    const operationType = payload.notifications.operation_type
    const performedByEmail = payload.notifications.performed_by_email
    const signedAt =
      typeof payload.notifications.performed_at === 'number'
        ? new Date(payload.notifications.performed_at).toISOString()
        : undefined

    await contractSignatoryService.handleDocusignSignedWebhook({
      envelopeId: payload.requests.request_id,
      recipientEmail: performedByEmail,
      status: operationType,
      signedAt,
      eventId: payload.notifications.action_id,
      signerIp: payload.notifications.ip_address,
      payload: rawPayload,
    })

    return NextResponse.json(okResponse({ received: true }))
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'Invalid Zoho Sign webhook payload'), { status: 400 })
    }

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to process Zoho Sign webhook'

    return NextResponse.json(errorResponse(code, message), { status })
  }
}
