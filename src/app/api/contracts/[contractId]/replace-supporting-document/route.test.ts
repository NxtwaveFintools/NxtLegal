import { BusinessRuleError } from '@/core/http/errors'

const mockSession = {
  employeeId: 'legal-user-id',
  tenantId: '00000000-0000-0000-0000-000000000000',
  role: 'LEGAL_TEAM',
  email: 'legal@nxtwave.co.in',
  fullName: 'Legal User',
}

const mockContractUploadService = {
  replaceSupportingDocument: jest.fn(),
}

const mockIdempotencyService = {
  claimOrGet: jest.fn(),
  store: jest.fn(),
  releaseClaim: jest.fn(),
}

type MockRequest = {
  headers: { get: (name: string) => string | null }
  formData: () => Promise<FormData>
}

type MockContext = {
  params?: Record<string, string>
}

type MockAuthHandler = (
  request: MockRequest,
  context: { session: typeof mockSession; params?: Record<string, string> }
) => unknown

jest.mock('@/core/http/with-auth', () => ({
  withAuth: (handler: MockAuthHandler) => {
    return async (request: MockRequest, context: MockContext = {}) => {
      return handler(request, {
        session: mockSession,
        params: context.params,
      })
    }
  },
}))

jest.mock('@/core/registry/service-registry', () => ({
  getContractUploadService: () => mockContractUploadService,
  getIdempotencyService: () => mockIdempotencyService,
}))

import { POST } from '@/app/api/contracts/[contractId]/replace-supporting-document/route'

type PostRequestArg = Parameters<typeof POST>[0]
type PostContextArg = Parameters<typeof POST>[1]

describe('Replace supporting contract document route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSession.tenantId = '00000000-0000-0000-0000-000000000000'
  })

  function createRequest(params?: {
    idempotencyKey?: string
    file?: File | null
    documentId?: string
  }): PostRequestArg {
    const form = new FormData()
    if (params?.file !== null) {
      form.set(
        'file',
        params?.file ?? new File([new Uint8Array([1, 2, 3])], 'supporting-v2.pdf', { type: 'application/pdf' })
      )
    }
    if (typeof params?.documentId === 'string') {
      form.set('documentId', params.documentId)
    } else {
      form.set('documentId', 'supporting-doc-1')
    }

    return {
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'idempotency-key') {
            return params?.idempotencyKey ?? 'replace-supporting-key-1'
          }

          return null
        },
      },
      formData: async () => form,
    } as PostRequestArg
  }

  it('returns document id required when document id is missing', async () => {
    const response = await POST(createRequest({ documentId: '   ' }), {
      params: { contractId: 'contract-1' },
    } as PostContextArg)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('DOCUMENT_ID_REQUIRED')
  })

  it('replaces supporting document on success', async () => {
    mockIdempotencyService.claimOrGet.mockResolvedValueOnce({ status: 'claimed' })
    mockContractUploadService.replaceSupportingDocument.mockResolvedValueOnce(undefined)

    const response = await POST(createRequest(), { params: { contractId: 'contract-1' } } as PostContextArg)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
    expect(mockContractUploadService.replaceSupportingDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        sourceDocumentId: 'supporting-doc-1',
        tenantId: mockSession.tenantId,
        uploadedByRole: mockSession.role,
      })
    )
    expect(mockIdempotencyService.store).toHaveBeenCalled()
  })

  it('maps app errors with status and code', async () => {
    mockIdempotencyService.claimOrGet.mockResolvedValueOnce({ status: 'claimed' })
    mockContractUploadService.replaceSupportingDocument.mockRejectedValueOnce(
      new BusinessRuleError('CONTRACT_IN_SIGNATURE_REPLACEMENT_FORBIDDEN', 'Blocked')
    )

    const response = await POST(createRequest(), { params: { contractId: 'contract-1' } } as PostContextArg)
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('CONTRACT_IN_SIGNATURE_REPLACEMENT_FORBIDDEN')
  })
})
