import { BusinessRuleError } from '@/core/http/errors'
import { createHmac } from 'crypto'

const mockContractSignatoryService = {
  handleZohoSignWebhook: jest.fn(),
}

jest.mock('@/core/registry/service-registry', () => ({
  getContractSignatoryService: () => mockContractSignatoryService,
}))

jest.mock('@/core/config/app-config', () => ({
  appConfig: {
    zohoSign: {
      webhookSecret: 'test-zoho-webhook-secret',
    },
  },
}))

import { appConfig } from '@/core/config/app-config'
import { POST } from '@/app/api/contracts/signatories/zoho-sign/webhook/route'

type PostRequestArg = Parameters<typeof POST>[0]

const createSignature = (rawBody: string, webhookSecret: string): string => {
  return createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest('base64')
}

describe('Zoho Sign signatory webhook route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(appConfig.zohoSign as { webhookSecret?: string }).webhookSecret = 'test-zoho-webhook-secret'
  })

  it('returns disabled when connect key is not configured', async () => {
    ;(appConfig.zohoSign as { webhookSecret?: string }).webhookSecret = undefined

    const response = await POST({
      headers: new Headers(),
      text: async () => JSON.stringify({}),
    } as unknown as PostRequestArg)

    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('ZOHO_SIGN_WEBHOOK_DISABLED')
  })

  it('returns forbidden for invalid webhook signature', async () => {
    const rawBody = JSON.stringify({
      notifications: { operation_type: 'RequestCompleted' },
      requests: { request_id: 'env-1' },
    })
    const response = await POST({
      headers: new Headers({ 'x-zs-webhook-signature': 'invalid-signature' }),
      text: async () => rawBody,
    } as unknown as PostRequestArg)

    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('ZOHO_SIGN_WEBHOOK_FORBIDDEN')
  })

  it('returns validation error for invalid payload', async () => {
    const rawBody = JSON.stringify({ requests: { request_id: '' } })
    const signature = createSignature(rawBody, 'test-zoho-webhook-secret')

    const response = await POST({
      headers: new Headers({ 'x-zs-webhook-signature': signature }),
      text: async () => rawBody,
    } as unknown as PostRequestArg)

    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('processes valid webhook payload', async () => {
    const payload = {
      notifications: {
        operation_type: 'RequestCompleted',
        action_id: 'action-1',
        performed_by_email: 'signer@nxtwave.co.in',
        performed_at: 1700000000000,
      },
      requests: {
        request_id: 'env-1',
        request_status: 'completed',
        actions: [
          {
            action_id: 'action-1',
            recipient_email: 'signer@nxtwave.co.in',
            action_status: 'SIGNED',
          },
        ],
      },
    }
    const rawBody = JSON.stringify(payload)
    const signature = createSignature(rawBody, 'test-zoho-webhook-secret')

    const response = await POST({
      headers: new Headers({ 'x-zs-webhook-signature': signature }),
      text: async () => rawBody,
    } as unknown as PostRequestArg)

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.received).toBe(true)
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenCalledTimes(2)
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenNthCalledWith(1, {
      envelopeId: 'env-1',
      recipientEmail: 'signer@nxtwave.co.in',
      status: 'SIGNED',
      signedAt: new Date(1700000000000).toISOString(),
      eventId: 'action-1',
      signerIp: undefined,
      payload,
    })
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenNthCalledWith(2, {
      envelopeId: 'env-1',
      recipientEmail: 'signer@nxtwave.co.in',
      status: 'RequestCompleted',
      signedAt: new Date(1700000000000).toISOString(),
      eventId: 'action-1',
      signerIp: undefined,
      payload,
    })
  })

  it('processes payload when signature header is missing', async () => {
    const payload = {
      notifications: {
        operation_type: 'RequestCompleted',
        action_id: 'action-1',
        performed_at: 1700000000000,
      },
      requests: {
        request_id: 'env-1',
        request_status: 'completed',
        actions: [
          {
            action_id: 'action-1',
            recipient_email: 'signer@nxtwave.co.in',
            action_status: 'SIGNED',
          },
        ],
      },
    }
    const rawBody = JSON.stringify(payload)

    const response = await POST({
      headers: new Headers(),
      text: async () => rawBody,
    } as unknown as PostRequestArg)

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.received).toBe(true)
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenCalledTimes(2)
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenNthCalledWith(1, {
      envelopeId: 'env-1',
      recipientEmail: 'signer@nxtwave.co.in',
      status: 'SIGNED',
      signedAt: new Date(1700000000000).toISOString(),
      eventId: 'action-1',
      signerIp: undefined,
      payload,
    })
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenNthCalledWith(2, {
      envelopeId: 'env-1',
      recipientEmail: 'signer@nxtwave.co.in',
      status: 'RequestCompleted',
      signedAt: new Date(1700000000000).toISOString(),
      eventId: 'action-1',
      signerIp: undefined,
      payload,
    })
  })

  it('processes lambda-wrapped payload and handles all signer actions', async () => {
    const payload = {
      notifications: {
        operation_type: 'RequestCompleted',
        performed_by_email: 'System Generated',
        performed_at: 1700000001000,
        ip_address: '49.200.108.250',
      },
      requests: {
        request_id: 'env-2',
        request_status: 'completed',
        action_time: 1700000002000,
        actions: [
          {
            action_id: 'action-11',
            recipient_email: 'one@nxtwave.co.in',
            action_status: 'SIGNED',
          },
          {
            action_id: 'action-22',
            recipient_email: 'two@nxtwave.co.in',
            action_status: 'SIGNED',
          },
        ],
      },
    }
    const rawBody = JSON.stringify({ body: JSON.stringify(payload) })
    const signature = createSignature(rawBody, 'test-zoho-webhook-secret')

    const response = await POST({
      headers: new Headers({ 'x-zs-webhook-signature': signature }),
      text: async () => rawBody,
    } as unknown as PostRequestArg)

    expect(response.status).toBe(200)
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenCalledTimes(3)
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenNthCalledWith(1, {
      envelopeId: 'env-2',
      recipientEmail: 'one@nxtwave.co.in',
      status: 'SIGNED',
      signedAt: new Date(1700000002000).toISOString(),
      eventId: 'action-11',
      signerIp: '49.200.108.250',
      payload,
    })
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenNthCalledWith(2, {
      envelopeId: 'env-2',
      recipientEmail: 'two@nxtwave.co.in',
      status: 'SIGNED',
      signedAt: new Date(1700000002000).toISOString(),
      eventId: 'action-22',
      signerIp: '49.200.108.250',
      payload,
    })
    expect(mockContractSignatoryService.handleZohoSignWebhook).toHaveBeenNthCalledWith(3, {
      envelopeId: 'env-2',
      recipientEmail: 'one@nxtwave.co.in',
      status: 'RequestCompleted',
      signedAt: new Date(1700000002000).toISOString(),
      eventId: 'env-2:REQUEST_COMPLETED',
      signerIp: '49.200.108.250',
      payload,
    })
  })

  it('maps app errors with status and code', async () => {
    mockContractSignatoryService.handleZohoSignWebhook.mockRejectedValueOnce(
      new BusinessRuleError('WEBHOOK_PAYLOAD_REJECTED', 'Rejected')
    )

    const rawBody = JSON.stringify({
      notifications: { operation_type: 'RequestCompleted' },
      requests: { request_id: 'env-1' },
    })
    const signature = createSignature(rawBody, 'test-zoho-webhook-secret')

    const response = await POST({
      headers: new Headers({ 'x-zs-webhook-signature': signature }),
      text: async () => rawBody,
    } as unknown as PostRequestArg)

    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('WEBHOOK_PAYLOAD_REJECTED')
  })
})
