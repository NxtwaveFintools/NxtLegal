import 'server-only'

import { createHmac, timingSafeEqual } from 'crypto'

export type SignatoryLinkTokenPayload = {
  envelopeId: string
  recipientEmail: string
  recipientId: string
  tokenId: string
}

const secret = process.env.JWT_SECRET_KEY ?? 'dev-signatory-link-secret'

const encodeBase64Url = (input: string): string => {
  return Buffer.from(input, 'utf8').toString('base64url')
}

const decodeBase64Url = (input: string): string => {
  return Buffer.from(input, 'base64url').toString('utf8')
}

const sign = (value: string): string => {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url')
}

export const createSignatoryLinkToken = async (
  payload: Omit<SignatoryLinkTokenPayload, 'tokenId'>
): Promise<string> => {
  // Validity: 30 days to align with requested link lifetime.
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
  const tokenId =
    (globalThis.crypto?.randomUUID?.() ?? undefined) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
  const encodedPayload = encodeBase64Url(
    JSON.stringify({
      envelopeId: payload.envelopeId,
      recipientEmail: payload.recipientEmail.trim().toLowerCase(),
      recipientId: payload.recipientId,
      tokenId,
      exp: expiresAt,
    })
  )
  const signature = sign(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export const verifySignatoryLinkToken = async (token: string): Promise<SignatoryLinkTokenPayload> => {
  const [encodedPayload, receivedSignature] = token.split('.')
  if (!encodedPayload || !receivedSignature) {
    throw new Error('Invalid signatory link token format')
  }

  const expectedSignature = sign(encodedPayload)
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8')
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new Error('Invalid signatory link token signature')
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<SignatoryLinkTokenPayload> & { exp?: number }
  if (!payload.envelopeId || !payload.recipientEmail || !payload.recipientId || !payload.tokenId || !payload.exp) {
    throw new Error('Invalid signatory link token payload')
  }

  if (Date.now() > payload.exp) {
    throw new Error('Signatory link token has expired')
  }

  return {
    envelopeId: payload.envelopeId,
    recipientEmail: payload.recipientEmail.trim().toLowerCase(),
    recipientId: payload.recipientId,
    tokenId: payload.tokenId,
  }
}
