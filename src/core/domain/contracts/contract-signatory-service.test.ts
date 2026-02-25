import { ContractSignatoryService } from '@/core/domain/contracts/contract-signatory-service'
import { ExternalServiceError } from '@/core/http/errors'

const mockContractView = {
  contract: {
    id: 'contract-1',
    title: 'Master Service Agreement',
  },
  documents: [],
  availableActions: [],
  additionalApprovers: [],
  signatories: [],
}

describe('ContractSignatoryService', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('assigns signatory by creating envelope, sending email, and persisting signatory', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn().mockResolvedValue(mockContractView),
      addSignatory: jest.fn().mockResolvedValue({ ...mockContractView, signatories: [{ id: 'sig-1' }] }),
      markSignatoryAsSigned: jest.fn(),
    }

    const contractDocumentDownloadService = {
      createSignedDownloadUrl: jest.fn().mockResolvedValue({
        signedUrl: 'https://example.com/signed-url',
        fileName: 'contract.pdf',
      }),
    }

    const signatureProvider = {
      createSigningEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'env-1',
        recipientId: '1',
        clientUserId: 'client-1',
        signingUrl: 'https://docusign.example/sign',
      }),
    }

    const signatoryMailer = {
      sendSignatoryLinkEmail: jest.fn().mockResolvedValue(undefined),
    }

    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: {
        get: () => 'application/pdf',
      },
    } as unknown as Response)

    const service = new ContractSignatoryService(
      contractQueryService as never,
      contractDocumentDownloadService,
      signatureProvider,
      signatoryMailer,
      'https://app.example.com',
      logger
    )

    const result = await service.assignSignatory({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
      signatoryEmail: 'signatory@nxtwave.co.in',
    })

    expect(contractDocumentDownloadService.createSignedDownloadUrl).toHaveBeenCalled()
    expect(signatureProvider.createSigningEnvelope).toHaveBeenCalled()
    expect(signatoryMailer.sendSignatoryLinkEmail).toHaveBeenCalled()
    expect(contractQueryService.addSignatory).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
      signatoryEmail: 'signatory@nxtwave.co.in',
      docusignEnvelopeId: 'env-1',
      docusignRecipientId: '1',
    })
    expect(result.signatories).toEqual([{ id: 'sig-1' }])
  })

  it('marks signatory as signed only for completed status', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn(),
      addSignatory: jest.fn(),
      markSignatoryAsSigned: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createSigningEnvelope: jest.fn() },
      { sendSignatoryLinkEmail: jest.fn() },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    )

    await service.handleDocusignSignedWebhook({
      tenantId: 'tenant-1',
      envelopeId: 'env-1',
      recipientEmail: 'signatory@nxtwave.co.in',
      status: 'completed',
    })

    expect(contractQueryService.markSignatoryAsSigned).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      envelopeId: 'env-1',
      recipientEmail: 'signatory@nxtwave.co.in',
      signedAt: undefined,
    })
  })

  it('raises external service error when docusign envelope creation fails', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn().mockResolvedValue(mockContractView),
      addSignatory: jest.fn(),
      markSignatoryAsSigned: jest.fn(),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      {
        createSignedDownloadUrl: jest.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed-url',
          fileName: 'contract.pdf',
        }),
      },
      {
        createSigningEnvelope: jest.fn().mockRejectedValue(new Error('DocuSign down')),
      },
      { sendSignatoryLinkEmail: jest.fn() },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    )

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => 'application/pdf' },
    } as unknown as Response)

    await expect(
      service.assignSignatory({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
        signatoryEmail: 'signatory@nxtwave.co.in',
      })
    ).rejects.toBeInstanceOf(ExternalServiceError)
  })
})
