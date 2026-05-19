const mockSession = {
  employeeId: 'employee-1',
  tenantId: '00000000-0000-0000-0000-000000000000',
  role: 'LEGAL_TEAM',
  email: 'legal@nxtwave.co.in',
  fullName: 'Legal User',
}

const mockIdempotencyService = {
  claimOrGet: jest.fn(),
  store: jest.fn(),
  releaseClaim: jest.fn(),
}

const mockContractQueryService = {
  applyContractAction: jest.fn(),
  bypassAdditionalApprover: jest.fn(),
  getContractDetail: jest.fn(),
  softResetActiveSigningCycle: jest.fn(),
}

const mockContractApprovalNotificationService = {
  notifyInternalAssignment: jest.fn(),
  notifyApprovalReceived: jest.fn(),
  notifyReturnedToHod: jest.fn(),
  notifyContractRejected: jest.fn(),
  notifyPocOnHodDecision: jest.fn(),
}

const mockContractSignatoryService = {
  recallSigningEnvelopes: jest.fn(),
}

type MockRequest = {
  headers: {
    get: (name: string) => string | null
  }
  json: () => Promise<unknown>
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
  getIdempotencyService: () => mockIdempotencyService,
  getContractQueryService: () => mockContractQueryService,
  getContractApprovalNotificationService: () => mockContractApprovalNotificationService,
  getContractSignatoryService: () => mockContractSignatoryService,
}))

import { POST } from '@/app/api/contracts/[contractId]/action/route'

type PostRequestArg = Parameters<typeof POST>[0]
type PostContextArg = Parameters<typeof POST>[1]

describe('Contract action route idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockContractQueryService.getContractDetail.mockResolvedValue({
      contract: { status: 'UNDER_REVIEW' },
    })
    mockContractQueryService.softResetActiveSigningCycle.mockResolvedValue(undefined)
  })

  it('returns conflict when same idempotency key is already in progress', async () => {
    mockIdempotencyService.claimOrGet.mockResolvedValue({ status: 'in-progress' })

    const response = await POST(
      {
        headers: {
          get: (name: string) => (name === 'Idempotency-Key' ? 'idem-action-1' : null),
        },
        json: async () => ({ action: 'legal.query' }),
      } as unknown as PostRequestArg,
      { params: { contractId: '33333333-3333-3333-3333-333333333333' } } as PostContextArg
    )

    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS')
    expect(mockContractQueryService.applyContractAction).not.toHaveBeenCalled()
  })

  it('stores successful action response when idempotency key is provided', async () => {
    mockIdempotencyService.claimOrGet.mockResolvedValue({ status: 'claimed' })
    mockContractQueryService.applyContractAction.mockResolvedValue({
      contractView: {
        contract: {
          id: '33333333-3333-3333-3333-333333333333',
          title: 'NDA',
          status: 'UNDER_REVIEW',
          currentAssigneeEmail: 'legal@nxtwave.co.in',
          uploadedByEmail: 'poc@nxtwave.co.in',
          departmentHodEmail: 'hod@nxtwave.co.in',
        },
        counterparties: [],
        documents: [],
        availableActions: [],
        additionalApprovers: [],
        legalCollaborators: [],
        signatories: [],
      },
      previousStatus: 'UNDER_REVIEW',
    })

    const response = await POST(
      {
        headers: {
          get: (name: string) => (name === 'Idempotency-Key' ? 'idem-action-2' : null),
        },
        json: async () => ({ action: 'legal.query' }),
      } as unknown as PostRequestArg,
      { params: { contractId: '33333333-3333-3333-3333-333333333333' } } as PostContextArg
    )

    expect(response.status).toBe(200)
    expect(mockIdempotencyService.store).toHaveBeenCalledWith(
      'idem-action-2',
      mockSession.tenantId,
      expect.objectContaining({ ok: true }),
      200
    )
  })

  it('recalls Zoho envelopes when legal.void is applied', async () => {
    mockIdempotencyService.claimOrGet.mockResolvedValue({ status: 'claimed' })
    mockContractSignatoryService.recallSigningEnvelopes.mockResolvedValue(undefined)
    mockContractQueryService.applyContractAction.mockResolvedValue({
      contractView: {
        contract: {
          id: '33333333-3333-3333-3333-333333333333',
          title: 'NDA',
          status: 'VOID',
          currentAssigneeEmail: 'legal@nxtwave.co.in',
          uploadedByEmail: 'poc@nxtwave.co.in',
          departmentHodEmail: 'hod@nxtwave.co.in',
        },
        counterparties: [],
        documents: [],
        availableActions: [],
        additionalApprovers: [],
        legalCollaborators: [],
        signatories: [
          { zohoSignEnvelopeId: 'envelope-1' },
          { zohoSignEnvelopeId: 'envelope-1' },
          { zohoSignEnvelopeId: 'envelope-2' },
        ],
      },
      previousStatus: 'SIGNING',
    })

    const response = await POST(
      {
        headers: {
          get: (name: string) => (name === 'Idempotency-Key' ? 'idem-action-3' : null),
        },
        json: async () => ({ action: 'legal.void', noteText: 'Incorrect recipient' }),
      } as unknown as PostRequestArg,
      { params: { contractId: '33333333-3333-3333-3333-333333333333' } } as PostContextArg
    )

    expect(response.status).toBe(200)
    expect(mockContractSignatoryService.recallSigningEnvelopes).toHaveBeenCalledWith({
      tenantId: mockSession.tenantId,
      contractId: '33333333-3333-3333-3333-333333333333',
      envelopeIds: ['envelope-1', 'envelope-2'],
      actorEmployeeId: mockSession.employeeId,
      actorRole: mockSession.role,
      actorEmail: mockSession.email,
      reason: 'Incorrect recipient',
    })
    expect(mockContractQueryService.softResetActiveSigningCycle).toHaveBeenCalledWith({
      tenantId: mockSession.tenantId,
      contractId: '33333333-3333-3333-3333-333333333333',
      actorEmployeeId: mockSession.employeeId,
      actorRole: mockSession.role,
      actorEmail: mockSession.email,
      reason: 'Incorrect recipient',
    })
  })

  it('recalls and soft-resets when legal exits signing to a non-signing status', async () => {
    mockIdempotencyService.claimOrGet.mockResolvedValue({ status: 'claimed' })
    mockContractSignatoryService.recallSigningEnvelopes.mockResolvedValue(undefined)
    mockContractQueryService.applyContractAction.mockResolvedValue({
      contractView: {
        contract: {
          id: '33333333-3333-3333-3333-333333333333',
          title: 'NDA',
          status: 'COMPLETED',
          currentAssigneeEmail: 'legal@nxtwave.co.in',
          uploadedByEmail: 'poc@nxtwave.co.in',
          departmentHodEmail: 'hod@nxtwave.co.in',
        },
        counterparties: [],
        documents: [],
        availableActions: [],
        additionalApprovers: [],
        legalCollaborators: [],
        signatories: [{ zohoSignEnvelopeId: 'envelope-3' }],
      },
      previousStatus: 'SIGNING',
    })

    const response = await POST(
      {
        headers: {
          get: (name: string) => (name === 'Idempotency-Key' ? 'idem-action-6' : null),
        },
        json: async () => ({ action: 'legal.set.completed' }),
      } as unknown as PostRequestArg,
      { params: { contractId: '33333333-3333-3333-3333-333333333333' } } as PostContextArg
    )

    expect(response.status).toBe(200)
    expect(mockContractSignatoryService.recallSigningEnvelopes).toHaveBeenCalledWith({
      tenantId: mockSession.tenantId,
      contractId: '33333333-3333-3333-3333-333333333333',
      envelopeIds: ['envelope-3'],
      actorEmployeeId: mockSession.employeeId,
      actorRole: mockSession.role,
      actorEmail: mockSession.email,
      reason: undefined,
    })
    expect(mockContractQueryService.softResetActiveSigningCycle).toHaveBeenCalled()
  })

  it('does not recall when previous status is not signing', async () => {
    mockIdempotencyService.claimOrGet.mockResolvedValue({ status: 'claimed' })
    mockContractQueryService.applyContractAction.mockResolvedValue({
      contractView: {
        contract: {
          id: '33333333-3333-3333-3333-333333333333',
          title: 'NDA',
          status: 'COMPLETED',
          currentAssigneeEmail: 'legal@nxtwave.co.in',
          uploadedByEmail: 'poc@nxtwave.co.in',
          departmentHodEmail: 'hod@nxtwave.co.in',
        },
        counterparties: [],
        documents: [],
        availableActions: [],
        additionalApprovers: [],
        legalCollaborators: [],
        signatories: [{ zohoSignEnvelopeId: 'envelope-4' }],
      },
      previousStatus: 'UNDER_REVIEW',
    })

    const response = await POST(
      {
        headers: {
          get: (name: string) => (name === 'Idempotency-Key' ? 'idem-action-7' : null),
        },
        json: async () => ({ action: 'legal.set.completed' }),
      } as unknown as PostRequestArg,
      { params: { contractId: '33333333-3333-3333-3333-333333333333' } } as PostContextArg
    )

    expect(response.status).toBe(200)
    expect(mockContractSignatoryService.recallSigningEnvelopes).not.toHaveBeenCalled()
    expect(mockContractQueryService.softResetActiveSigningCycle).not.toHaveBeenCalled()
  })

  it('notifies POC when HOD approves a contract', async () => {
    mockIdempotencyService.claimOrGet.mockResolvedValue({ status: 'claimed' })
    mockContractQueryService.applyContractAction.mockResolvedValue({
      contractView: {
        contract: {
          id: '33333333-3333-3333-3333-333333333333',
          title: 'MSA',
          status: 'UNDER_REVIEW',
          currentAssigneeEmail: 'legal@nxtwave.co.in',
          uploadedByEmail: 'poc@nxtwave.co.in',
          departmentHodEmail: 'hod@nxtwave.co.in',
        },
        counterparties: [],
        documents: [],
        availableActions: [],
        additionalApprovers: [],
        legalCollaborators: [],
        signatories: [],
      },
      previousStatus: 'HOD_PENDING',
    })

    const response = await POST(
      {
        headers: {
          get: (name: string) => (name === 'Idempotency-Key' ? 'idem-action-4' : null),
        },
        json: async () => ({ action: 'hod.approve' }),
      } as unknown as PostRequestArg,
      { params: { contractId: '33333333-3333-3333-3333-333333333333' } } as PostContextArg
    )

    expect(response.status).toBe(200)
    expect(mockContractApprovalNotificationService.notifyPocOnHodDecision).toHaveBeenCalledWith({
      tenantId: mockSession.tenantId,
      contractId: '33333333-3333-3333-3333-333333333333',
      actorEmployeeId: mockSession.employeeId,
      actorRole: mockSession.role,
      pocEmail: 'poc@nxtwave.co.in',
      decision: 'APPROVED',
      contractTitle: 'MSA',
    })
  })

  it('notifies POC when HOD rejects a contract', async () => {
    mockIdempotencyService.claimOrGet.mockResolvedValue({ status: 'claimed' })
    mockContractQueryService.applyContractAction.mockResolvedValue({
      contractView: {
        contract: {
          id: '33333333-3333-3333-3333-333333333333',
          title: 'MSA',
          status: 'REJECTED',
          currentAssigneeEmail: 'hod@nxtwave.co.in',
          uploadedByEmail: 'poc@nxtwave.co.in',
          departmentHodEmail: 'hod@nxtwave.co.in',
        },
        counterparties: [],
        documents: [],
        availableActions: [],
        additionalApprovers: [],
        legalCollaborators: [],
        signatories: [],
      },
      previousStatus: 'HOD_PENDING',
    })

    const response = await POST(
      {
        headers: {
          get: (name: string) => (name === 'Idempotency-Key' ? 'idem-action-5' : null),
        },
        json: async () => ({ action: 'hod.reject', noteText: 'Incorrect details' }),
      } as unknown as PostRequestArg,
      { params: { contractId: '33333333-3333-3333-3333-333333333333' } } as PostContextArg
    )

    expect(response.status).toBe(200)
    expect(mockContractApprovalNotificationService.notifyPocOnHodDecision).toHaveBeenCalledWith({
      tenantId: mockSession.tenantId,
      contractId: '33333333-3333-3333-3333-333333333333',
      actorEmployeeId: mockSession.employeeId,
      actorRole: mockSession.role,
      pocEmail: 'poc@nxtwave.co.in',
      decision: 'REJECTED',
      contractTitle: 'MSA',
    })
  })
})
