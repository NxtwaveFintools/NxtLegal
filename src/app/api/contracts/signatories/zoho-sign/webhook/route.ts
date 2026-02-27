import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { ZodError } from 'zod'
import { errorResponse, okResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { appConfig } from '@/core/config/app-config'
import { getContractSignatoryService } from '@/core/registry/service-registry'
import { zohoSignWebhookSchema } from '@/core/domain/contracts/schemas'
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

const normalizeStatusToken = (value: string): string => {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const isCompletionOperation = (operationType: string, requestStatus?: string): boolean => {
  const operationToken = normalizeStatusToken(operationType)
  const requestToken = requestStatus ? normalizeStatusToken(requestStatus) : ''
  return operationToken === 'REQUEST_COMPLETED' || requestToken === 'COMPLETED'
}

export async function POST(request: NextRequest) {
  try {
    const webhookSecret = appConfig.zohoSign.webhookSecret
    if (!webhookSecret) {
      return NextResponse.json(errorResponse('ZOHO_SIGN_WEBHOOK_DISABLED', 'Zoho Sign webhook is not configured'), {
        status: 503,
      })
    }

    const rawBody = await request.text()
    const receivedSignatureHeader = request.headers.get('x-zs-webhook-signature')
    const receivedSignature = receivedSignatureHeader ? decodeZohoSignature(receivedSignatureHeader) : null
    const hasSignatureHeader = Boolean(receivedSignatureHeader)
    const expectedDigest = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest()
    const signatureValid = hasSignatureHeader
      ? Boolean(receivedSignature && isDigestMatch(expectedDigest, receivedSignature))
      : true

    logger.info('ZOHO_SIGN_SIGNATURE_VALIDATION_RESULT', {
      signatureValid,
      hasSignatureHeader,
      signatureHeaderName: 'x-zs-webhook-signature',
    })

    if (!signatureValid) {
      return NextResponse.json(errorResponse('ZOHO_SIGN_WEBHOOK_FORBIDDEN', 'Invalid webhook signature'), {
        status: 401,
      })
    }

    const parsedBody = JSON.parse(rawBody) as Record<string, unknown>
    const rawPayload = parseZohoWebhookPayload(parsedBody)
    const payload = zohoSignWebhookSchema.parse(rawPayload)
    const contractSignatoryService = getContractSignatoryService()

    const envelopeId = payload.requests.request_id
    const signedAtEpoch = payload.requests.action_time ?? payload.notifications.performed_at
    const signedAt = typeof signedAtEpoch === 'number' ? new Date(signedAtEpoch).toISOString() : undefined
    const signerIp = payload.notifications.ip_address
    const operationType = payload.notifications.operation_type
    const requestStatus = payload.requests.request_status
    const actionEvents = payload.requests.actions ?? []
    const shouldEmitCompletionEvent = isCompletionOperation(operationType, requestStatus)

    if (actionEvents.length > 0) {
      for (const actionEvent of actionEvents) {
        await contractSignatoryService.handleZohoSignWebhook({
          envelopeId,
          recipientEmail: actionEvent.recipient_email,
          status: actionEvent.action_status ?? requestStatus ?? operationType,
          signedAt,
          eventId: actionEvent.action_id ?? payload.notifications.action_id,
          signerIp,
          payload: rawPayload,
        })
      }

      if (shouldEmitCompletionEvent) {
        const completionRecipientEmail = actionEvents[0]?.recipient_email
        await contractSignatoryService.handleZohoSignWebhook({
          envelopeId,
          recipientEmail: completionRecipientEmail,
          status: operationType,
          signedAt,
          eventId: payload.notifications.action_id ?? `${envelopeId}:REQUEST_COMPLETED`,
          signerIp,
          payload: rawPayload,
        })
      }
    } else {
      await contractSignatoryService.handleZohoSignWebhook({
        envelopeId,
        recipientEmail: undefined,
        status: requestStatus ?? operationType,
        signedAt,
        eventId: payload.notifications.action_id,
        signerIp,
        payload: rawPayload,
      })
    }

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

const parseZohoWebhookPayload = (input: Record<string, unknown>): Record<string, unknown> => {
  const nestedBody = input.body
  if (typeof nestedBody !== 'string') {
    return input
  }

  try {
    const parsedNestedBody = JSON.parse(nestedBody)
    return parsedNestedBody as Record<string, unknown>
  } catch {
    return input
  }
}
