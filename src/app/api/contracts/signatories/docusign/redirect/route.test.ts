const mockContractQueryService = {
  resolveEnvelopeContext: jest.fn(),
}

const mockCreateEmbeddedSigningUrl = jest.fn()

jest.mock('@/core/registry/service-registry', () => ({
  getContractQueryService: () => mockContractQueryService,
}))

jest.mock('@/core/config/app-config', () => ({
  appConfig: {
    auth: { siteUrl: 'https://app.example.com' },
    zohoSign: {
      apiBaseUrl: 'https://sign.zoho.in/api/v1',
      accessToken: 'test-token',
      webhookSecret: 'test-secret',
    },
  },
}))

jest.mock('@/core/infra/integrations/zoho-sign/zoho-sign-client', () => ({
  ZohoSignClient: jest.fn().mockImplementation(() => ({
    createEmbeddedSigningUrl: mockCreateEmbeddedSigningUrl,
  })),
}))

jest.mock('@/core/infra/security/signatory-link-token', () => ({
  verifySignatoryLinkToken: jest.fn(),
}))

import { verifySignatoryLinkToken } from '@/core/infra/security/signatory-link-token'
import { GET } from '@/app/api/contracts/signatories/docusign/redirect/route'

describe('Signatory redirect route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns bad request when token is missing', async () => {
    const response = await GET({
      nextUrl: new URL('https://app.example.com/api/contracts/signatories/docusign/redirect'),
    } as unknown as Parameters<typeof GET>[0])

    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error.code).toBe('SIGNATORY_LINK_INVALID')
  })

  it('redirects to fresh Zoho embedded URL for valid token', async () => {
    ;(verifySignatoryLinkToken as jest.Mock).mockResolvedValueOnce({
      envelopeId: 'req-1',
      recipientEmail: 'signer@nxtwave.co.in',
      recipientId: 'action-1',
    })

    mockContractQueryService.resolveEnvelopeContext.mockResolvedValueOnce({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      signatoryEmail: 'signer@nxtwave.co.in',
      recipientType: 'EXTERNAL',
      routingOrder: 1,
    })

    mockCreateEmbeddedSigningUrl.mockResolvedValueOnce('https://sign.zoho.in/embed/sign-url')

    const response = await GET({
      nextUrl: new URL('https://app.example.com/api/contracts/signatories/docusign/redirect?token=abc'),
    } as unknown as Parameters<typeof GET>[0])

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://sign.zoho.in/embed/sign-url')
  })
})
