import { ContractSignatoryService } from '@/core/domain/contracts/contract-signatory-service'
import { AuthorizationError, BusinessRuleError, ExternalServiceError } from '@/core/http/errors'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'

/**
 * Decodes a page's content stream from saved PDF bytes.
 *
 * Byte-length comparisons cannot prove text was drawn: embedFont runs
 * unconditionally, so the font dictionary alone changes the length even when
 * the text value was dropped. Only the show-text operator settles it.
 */
async function readPageContentStream(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(pageIndex)
  const context = page.node.context
  const contents = context.lookup(page.node.get(PDFName.of('Contents')))

  if (!contents) {
    return ''
  }

  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => context.lookup(ref)) : [contents]

  return streams
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'))
    .join('\n')
}

/** pdf-lib writes show-text operands as an uppercase hex string of WinAnsi bytes. */
function toPdfHexString(value: string): string {
  return Array.from(value)
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase())
    .join('')
}

const mockContractView = {
  contract: {
    id: 'contract-1',
    title: 'Master Service Agreement',
    status: 'COMPLETED',
    currentDocumentId: 'document-primary-1',
  },
  documents: [],
  availableActions: [],
  additionalApprovers: [],
  signatories: [],
}

const createContractView = () => structuredClone(mockContractView)
const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
})

describe('ContractSignatoryService', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('downloads merged signing artifact with certificate pages first', async () => {
    const createPdf = async (width: number, height: number): Promise<Uint8Array> => {
      const pdf = await PDFDocument.create()
      pdf.addPage([width, height])
      return await pdf.save()
    }

    const certificatePdf = await createPdf(320, 220)
    const executedPdf = await createPdf(640, 480)

    const contractQueryService = {
      getContractDetail: jest.fn().mockResolvedValue({
        ...createContractView(),
        signatories: [{ zohoSignEnvelopeId: 'env-merged-1' }],
      }),
    }

    const contractStorageRepository = {
      upload: jest.fn(),
    }

    const contractRepository = {
      createDocument: jest.fn(),
    }

    const signatureProvider = {
      createSigningEnvelope: jest.fn(),
      downloadCompletedEnvelopeDocuments: jest.fn().mockResolvedValue({
        executedPdf,
        certificatePdf,
      }),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      contractRepository as never,
      contractStorageRepository as never,
      signatureProvider,
      { sendTemplateEmail: jest.fn() },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    const result = await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'merged_pdf',
    })

    if (!('fileBytes' in result)) {
      throw new Error('Expected merged artifact bytes in response')
    }

    const mergedDoc = await PDFDocument.load(result.fileBytes)
    const pages = mergedDoc.getPages()

    expect(pages).toHaveLength(2)
    expect(pages[0].getWidth()).toBe(320)
    expect(pages[0].getHeight()).toBe(220)
    expect(pages[1].getWidth()).toBe(640)
    expect(pages[1].getHeight()).toBe(480)
    // No signatory carries a status/signedAt, so the date segment is omitted.
    expect(result.fileName).toBe('Master Service Agreement - Signed with Certificate.pdf')
    expect(signatureProvider.downloadCompletedEnvelopeDocuments).toHaveBeenCalledWith({
      envelopeId: 'env-merged-1',
    })
    expect(contractStorageRepository.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'tenant-1/contract-1/executed/env-merged-1/completion-certificate-and-executed-merged.pdf',
        contentType: 'application/pdf',
      })
    )
    expect(contractRepository.createDocument).not.toHaveBeenCalled()
  })

  it('sends signed confirmation email to internal signer on SIGNED webhook', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn(),
      addSignatory: jest.fn(),
      markSignatoryAsSigned: jest.fn().mockResolvedValue(undefined),
      getContractDocumentsBySystem: jest.fn().mockResolvedValue([]),
      resolveEnvelopeContext: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        signatoryEmail: 'internal@nxtwave.co.in',
        recipientType: 'INTERNAL',
        routingOrder: 1,
      }),
      recordZohoSignWebhookEvent: jest.fn().mockResolvedValue({ inserted: true }),
      addSignatoryWebhookAuditEvent: jest.fn().mockResolvedValue(undefined),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getLatestNotificationDelivery: jest.fn().mockResolvedValue(null),
      getEnvelopeNotificationProfile: jest.fn().mockResolvedValue({
        contractTitle: 'Master Service Agreement',
        recipientEmails: ['internal@nxtwave.co.in'],
      }),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      createSignedDownloadUrl: jest.fn().mockResolvedValue('https://storage.example/executed.pdf'),
    }

    const signatoryMailer = {
      sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-3' }),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      contractStorageRepository as never,
      {
        createSigningEnvelope: jest.fn(),
        downloadCompletedEnvelopeDocuments: jest.fn(),
      },
      signatoryMailer,
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await service.handleZohoSignSignedWebhook({
      envelopeId: 'env-1',
      recipientEmail: 'internal@nxtwave.co.in',
      status: 'signed',
      payload: {
        envelopeId: 'env-1',
        status: 'signed',
      },
    })

    expect(signatoryMailer.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'internal@nxtwave.co.in',
        subject: 'You Signed: Master Service Agreement',
        htmlContent: expect.stringContaining('https://storage.example/executed.pdf'),
      })
    )
    expect(contractQueryService.recordContractNotificationDelivery).toHaveBeenCalled()
  })

  it('dedupes internal signer confirmation when already sent for same envelope', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn(),
      addSignatory: jest.fn(),
      markSignatoryAsSigned: jest.fn().mockResolvedValue(undefined),
      getContractDocumentsBySystem: jest.fn().mockResolvedValue([]),
      resolveEnvelopeContext: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        signatoryEmail: 'internal@nxtwave.co.in',
        recipientType: 'INTERNAL',
        routingOrder: 1,
      }),
      recordZohoSignWebhookEvent: jest.fn().mockResolvedValue({ inserted: true }),
      addSignatoryWebhookAuditEvent: jest.fn().mockResolvedValue(undefined),
      getLatestNotificationDelivery: jest.fn().mockResolvedValue({
        id: 'delivery-1',
        createdAt: new Date().toISOString(),
        status: 'SENT',
      }),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn().mockResolvedValue({
        contractTitle: 'Master Service Agreement',
        recipientEmails: ['internal@nxtwave.co.in'],
      }),
    }

    const signatoryMailer = {
      sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-3' }),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn(), createSignedDownloadUrl: jest.fn() } as never,
      {
        createSigningEnvelope: jest.fn(),
        downloadCompletedEnvelopeDocuments: jest.fn(),
      },
      signatoryMailer,
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await service.handleZohoSignSignedWebhook({
      envelopeId: 'env-1',
      recipientEmail: 'internal@nxtwave.co.in',
      status: 'signed',
      payload: {
        envelopeId: 'env-1',
        status: 'signed',
      },
    })

    expect(contractQueryService.getLatestNotificationDelivery).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      envelopeId: 'env-1',
      recipientEmail: 'internal@nxtwave.co.in',
      notificationType: 'SIGNING_COMPLETED',
    })
    expect(signatoryMailer.sendTemplateEmail).not.toHaveBeenCalled()
    expect(contractQueryService.recordContractNotificationDelivery).not.toHaveBeenCalled()
  })

  it('sends Brevo email with embedded link for internal recipient', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn().mockResolvedValue(createContractView()),
      addSignatory: jest.fn().mockResolvedValue({
        ...createContractView(),
        signatories: [{ id: 'sig-1' }],
      }),
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue(null),
      getContractDocumentsBySystem: jest.fn().mockResolvedValue([]),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      addSignatoryWebhookAuditEvent: jest.fn().mockResolvedValue(undefined),
      markSignatoryAsSigned: jest.fn().mockResolvedValue(undefined),
      moveContractToInSignature: jest.fn().mockResolvedValue(undefined),
      deleteSigningPreparationDraft: jest.fn().mockResolvedValue(undefined),
      resolveEnvelopeContext: jest.fn(),
      getEnvelopeNotificationProfile: jest
        .fn()
        .mockResolvedValue({ contractTitle: 'Master Service Agreement', recipientEmails: [] }),
    } as never

    const contractDocumentDownloadService = {
      createSignedDownloadUrl: jest.fn().mockResolvedValue({
        signedUrl: 'https://signed-url',
        fileName: 'msa.pdf',
      }),
    } as never

    const contractRepository = {
      createDocument: jest.fn(),
    } as never

    const contractStorageRepository = {
      upload: jest.fn(),
    } as never

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('pdf'),
      headers: {
        get: () => 'application/pdf',
      },
    })
    const originalFetch = global.fetch
    global.fetch = fetchMock as unknown as typeof fetch

    const signatureProvider = {
      createSigningEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'env-1',
        recipients: [
          {
            email: 'founder@nxtwave.co.in',
            recipientId: '1',
            clientUserId: '1',
            signingUrl: '',
          },
        ],
      }),
      downloadCompletedEnvelopeDocuments: jest.fn(),
    } as never

    const signatoryMailer = {
      sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }),
    }

    const service = new ContractSignatoryService(
      contractQueryService,
      contractDocumentDownloadService,
      contractRepository,
      contractStorageRepository,
      signatureProvider,
      signatoryMailer as unknown as ContractSignatoryService['signatoryMailer'],
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      createLogger(),
      { findStampBytes: jest.fn() }
    )

    await service.assignSignatory({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
      recipients: [
        {
          signatoryEmail: 'founder@nxtwave.co.in',
          recipientType: 'INTERNAL',
          routingOrder: 1,
          fields: [],
        },
      ],
    })

    global.fetch = originalFetch

    expect(signatoryMailer.sendTemplateEmail).toHaveBeenCalledTimes(1)
    const sentEmailPayload = signatoryMailer.sendTemplateEmail.mock.calls[0]?.[0] as
      | {
          recipientEmail?: string
          subject?: string
          templateParams?: { signing_url?: string }
          htmlContent?: string
        }
      | undefined
    expect(sentEmailPayload?.recipientEmail).toBe('founder@nxtwave.co.in')
    expect(sentEmailPayload?.subject).toBe(
      'Signature Requested: Master Service Agreement - NxtWave Disruptive Technologies Private Limited'
    )
    const signingUrlFromTemplate = sentEmailPayload?.templateParams?.signing_url ?? ''
    const signingUrlFromHtml = sentEmailPayload?.htmlContent ?? ''
    expect(`${signingUrlFromTemplate}\n${signingUrlFromHtml}`).toContain(
      '/api/contracts/signatories/zoho-sign/redirect?token='
    )
  })

  it('assigns signatory by creating envelope, sending email, and persisting signatory', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn().mockResolvedValue(mockContractView),
      addSignatory: jest.fn().mockResolvedValue({ ...mockContractView, signatories: [{ id: 'sig-1' }] }),
      markSignatoryAsSigned: jest.fn(),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn().mockResolvedValue({
        contractTitle: 'Master Service Agreement',
        recipientEmails: ['signatory@nxtwave.co.in'],
      }),
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
        recipients: [
          {
            email: 'signatory@nxtwave.co.in',
            recipientId: '1',
            clientUserId: 'client-1',
            signingUrl: 'https://sign.zoho.in/sign/signer-link-1',
          },
        ],
      }),
      downloadCompletedEnvelopeDocuments: jest.fn(),
    }

    const signatoryMailer = {
      sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }),
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
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      signatureProvider,
      signatoryMailer,
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      logger,
      { findStampBytes: jest.fn() }
    )

    const result = await service.assignSignatory({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
      recipients: [
        {
          signatoryEmail: 'signatory@nxtwave.co.in',
          recipientType: 'EXTERNAL',
          routingOrder: 1,
          fields: [],
        },
      ],
    })

    expect(contractDocumentDownloadService.createSignedDownloadUrl).toHaveBeenCalledWith({
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      requestorEmployeeId: 'legal-1',
      requestorRole: 'LEGAL_TEAM',
      documentId: 'document-primary-1',
    })
    expect(signatureProvider.createSigningEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        emailSubject: 'Master Service Agreement',
      })
    )
    expect(signatoryMailer.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'signatory@nxtwave.co.in',
        subject: 'Signature Requested: Master Service Agreement - NxtWave Disruptive Technologies Private Limited',
        htmlContent: expect.stringContaining('/api/contracts/signatories/zoho-sign/redirect?token='),
      })
    )
    expect(contractQueryService.recordContractNotificationDelivery).toHaveBeenCalled()
    expect(contractQueryService.addSignatory).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
      signatoryEmail: 'signatory@nxtwave.co.in',
      recipientType: 'EXTERNAL',
      routingOrder: 1,
      fieldConfig: [],
      zohoSignEnvelopeId: 'env-1',
      zohoSignRecipientId: '1',
      envelopeSourceDocumentId: 'document-primary-1',
    })
    expect(result.signatories).toEqual([{ id: 'sig-1' }])
  })

  it('marks signatory as signed only for completed status', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn(),
      addSignatory: jest.fn(),
      markSignatoryAsSigned: jest.fn().mockResolvedValue(undefined),
      getContractDocumentsBySystem: jest.fn().mockResolvedValue([]),
      resolveEnvelopeContext: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        signatoryEmail: 'signatory@nxtwave.co.in',
        recipientType: 'EXTERNAL',
        routingOrder: 1,
      }),
      recordZohoSignWebhookEvent: jest.fn().mockResolvedValue({ inserted: true }),
      addSignatoryWebhookAuditEvent: jest.fn().mockResolvedValue(undefined),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn().mockResolvedValue({
        contractTitle: 'Master Service Agreement',
        recipientEmails: ['signatory@nxtwave.co.in'],
      }),
    }

    const contractRepository = {
      createDocument: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      contractRepository as never,
      contractStorageRepository as never,
      {
        createSigningEnvelope: jest.fn(),
        downloadCompletedEnvelopeDocuments: jest.fn().mockResolvedValue({
          executedPdf: new Uint8Array([1, 2]),
          certificatePdf: new Uint8Array([3, 4]),
        }),
      },
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-2' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await service.handleZohoSignSignedWebhook({
      envelopeId: 'env-1',
      recipientEmail: 'signatory@nxtwave.co.in',
      status: 'completed',
      payload: {
        envelopeId: 'env-1',
        status: 'completed',
      },
    })

    expect(contractQueryService.recordZohoSignWebhookEvent).toHaveBeenCalled()
    expect(contractQueryService.addSignatoryWebhookAuditEvent).toHaveBeenCalled()
    expect(contractQueryService.markSignatoryAsSigned).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      envelopeId: 'env-1',
      recipientEmail: 'signatory@nxtwave.co.in',
      signedAt: undefined,
    })
    expect(contractStorageRepository.upload).toHaveBeenCalledTimes(2)
    expect(contractRepository.createDocument).toHaveBeenCalledTimes(2)
    expect(contractQueryService.getEnvelopeNotificationProfile).toHaveBeenCalled()
    expect(contractQueryService.recordContractNotificationDelivery).toHaveBeenCalled()
  })

  it('processes completion artifacts for duplicate webhook when artifacts are still missing', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn(),
      addSignatory: jest.fn(),
      markSignatoryAsSigned: jest.fn().mockResolvedValue(undefined),
      getContractDocumentsBySystem: jest.fn().mockResolvedValue([]),
      resolveEnvelopeContext: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        signatoryEmail: 'signatory@nxtwave.co.in',
        recipientType: 'EXTERNAL',
        routingOrder: 1,
      }),
      recordZohoSignWebhookEvent: jest.fn().mockResolvedValue({ inserted: false }),
      addSignatoryWebhookAuditEvent: jest.fn().mockResolvedValue(undefined),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn().mockResolvedValue({
        contractTitle: 'Master Service Agreement',
        recipientEmails: ['signatory@nxtwave.co.in'],
      }),
    }

    const contractRepository = {
      createDocument: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      contractRepository as never,
      contractStorageRepository as never,
      {
        createSigningEnvelope: jest.fn(),
        downloadCompletedEnvelopeDocuments: jest.fn().mockResolvedValue({
          executedPdf: new Uint8Array([1, 2]),
          certificatePdf: new Uint8Array([3, 4]),
        }),
      },
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-2' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await service.handleZohoSignSignedWebhook({
      envelopeId: 'env-1',
      recipientEmail: 'signatory@nxtwave.co.in',
      status: 'completed',
      payload: {
        envelopeId: 'env-1',
        status: 'completed',
      },
    })

    expect(contractStorageRepository.upload).toHaveBeenCalledTimes(2)
    expect(contractRepository.createDocument).toHaveBeenCalledTimes(2)
    expect(contractQueryService.getEnvelopeNotificationProfile).not.toHaveBeenCalled()
  })

  it('normalizes hyphenated completion status values', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn(),
      addSignatory: jest.fn(),
      markSignatoryAsSigned: jest.fn().mockResolvedValue(undefined),
      getContractDocumentsBySystem: jest.fn().mockResolvedValue([]),
      resolveEnvelopeContext: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        signatoryEmail: 'signatory@nxtwave.co.in',
        recipientType: 'EXTERNAL',
        routingOrder: 1,
      }),
      recordZohoSignWebhookEvent: jest.fn().mockResolvedValue({ inserted: true }),
      addSignatoryWebhookAuditEvent: jest.fn().mockResolvedValue(undefined),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn().mockResolvedValue({
        contractTitle: 'Master Service Agreement',
        recipientEmails: ['signatory@nxtwave.co.in'],
      }),
    }

    const contractRepository = {
      createDocument: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      contractRepository as never,
      contractStorageRepository as never,
      {
        createSigningEnvelope: jest.fn(),
        downloadCompletedEnvelopeDocuments: jest.fn().mockResolvedValue({
          executedPdf: new Uint8Array([1, 2]),
          certificatePdf: new Uint8Array([3, 4]),
        }),
      },
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-2' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await service.handleZohoSignSignedWebhook({
      envelopeId: 'env-1',
      recipientEmail: 'signatory@nxtwave.co.in',
      status: 'envelope-completed',
      payload: {
        envelopeId: 'env-1',
        status: 'envelope-completed',
      },
    })

    expect(contractQueryService.markSignatoryAsSigned).toHaveBeenCalledTimes(1)
    expect(contractStorageRepository.upload).toHaveBeenCalledTimes(2)
    expect(contractRepository.createDocument).toHaveBeenCalledTimes(2)
  })

  it('raises external service error when zoho sign request creation fails', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn().mockResolvedValue(mockContractView),
      addSignatory: jest.fn(),
      markSignatoryAsSigned: jest.fn(),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn(),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      {
        createSignedDownloadUrl: jest.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed-url',
          fileName: 'contract.pdf',
        }),
      },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      {
        createSigningEnvelope: jest.fn().mockRejectedValue(new Error('Zoho Sign down')),
        downloadCompletedEnvelopeDocuments: jest.fn(),
      },
      { sendTemplateEmail: jest.fn() },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
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
        recipients: [
          {
            signatoryEmail: 'signatory@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
            fields: [],
          },
        ],
      })
    ).rejects.toBeInstanceOf(ExternalServiceError)
  })

  it('rejects signatory assignment outside COMPLETED', async () => {
    const contractQueryService = {
      getContractDetail: jest.fn().mockResolvedValue({
        ...mockContractView,
        contract: {
          ...mockContractView.contract,
          status: 'LEGAL_PENDING',
        },
      }),
      addSignatory: jest.fn(),
      markSignatoryAsSigned: jest.fn(),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn(),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      { createSigningEnvelope: jest.fn(), downloadCompletedEnvelopeDocuments: jest.fn() },
      { sendTemplateEmail: jest.fn() },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.assignSignatory({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
        recipients: [
          {
            signatoryEmail: 'signatory@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
            fields: [],
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'SIGNATORY_ASSIGN_INVALID_STATUS' })
  })

  it('enforces signature-per-recipient validation before send', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue({
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Internal User',
            email: 'internal@nxtwave.co.in',
            recipientType: 'INTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [
          {
            fieldType: 'TEXT',
            pageNumber: 1,
            xPosition: 10,
            yPosition: 20,
            anchorString: null,
            assignedSignerEmail: 'internal@nxtwave.co.in',
          },
        ],
      }),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      { createSigningEnvelope: jest.fn(), downloadCompletedEnvelopeDocuments: jest.fn() },
      { sendTemplateEmail: jest.fn() },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.sendSigningPreparationDraft({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
      })
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'SIGNING_PREPARATION_SIGNATURE_REQUIRED',
    })
  })

  it('enforces routing order validation before send', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue({
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Internal User',
            email: 'internal@nxtwave.co.in',
            recipientType: 'INTERNAL',
            routingOrder: 0,
          },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 10,
            yPosition: 20,
            anchorString: null,
            assignedSignerEmail: 'internal@nxtwave.co.in',
          },
        ],
      }),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      { createSigningEnvelope: jest.fn(), downloadCompletedEnvelopeDocuments: jest.fn() },
      { sendTemplateEmail: jest.fn() },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.sendSigningPreparationDraft({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
      })
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'SIGNING_PREPARATION_ROUTING_ORDER_INVALID',
    })
  })

  it('rejects mixed routing order mode before send', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue({
        contractId: 'contract-1',
        recipients: [
          { name: 'Signer One', email: 'one@nxtwave.co.in', recipientType: 'EXTERNAL', routingOrder: 1 },
          { name: 'Signer Two', email: 'two@nxtwave.co.in', recipientType: 'EXTERNAL', routingOrder: 1 },
          { name: 'Signer Three', email: 'three@nxtwave.co.in', recipientType: 'EXTERNAL', routingOrder: 2 },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 10,
            yPosition: 20,
            anchorString: null,
            assignedSignerEmail: 'one@nxtwave.co.in',
          },
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 20,
            yPosition: 30,
            anchorString: null,
            assignedSignerEmail: 'two@nxtwave.co.in',
          },
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 30,
            yPosition: 40,
            anchorString: null,
            assignedSignerEmail: 'three@nxtwave.co.in',
          },
        ],
      }),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      { createSigningEnvelope: jest.fn(), downloadCompletedEnvelopeDocuments: jest.fn() },
      { sendTemplateEmail: jest.fn() },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.sendSigningPreparationDraft({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
      })
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'SIGNING_PREPARATION_ROUTING_ORDER_INVALID',
    })
  })

  it('allows parallel send when all routing orders are identical', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue({
        contractId: 'contract-1',
        recipients: [
          { name: 'Signer One', email: 'one@nxtwave.co.in', recipientType: 'EXTERNAL', routingOrder: 1 },
          { name: 'Signer Two', email: 'two@nxtwave.co.in', recipientType: 'EXTERNAL', routingOrder: 1 },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 10,
            yPosition: 20,
            anchorString: null,
            assignedSignerEmail: 'one@nxtwave.co.in',
          },
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 20,
            yPosition: 30,
            anchorString: null,
            assignedSignerEmail: 'two@nxtwave.co.in',
          },
        ],
      }),
      getContractDetail: jest.fn().mockResolvedValue({
        ...mockContractView,
        contract: { ...mockContractView.contract, currentDocumentId: 'doc-1' },
      }),
      addSignatory: jest.fn().mockResolvedValue({
        ...mockContractView,
        signatories: [
          {
            id: 'sig-1',
            signatoryEmail: 'one@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
            fieldConfig: [],
            status: 'PENDING',
            signedAt: null,
            zohoSignEnvelopeId: 'env-123',
            zohoSignRecipientId: 'a1',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'sig-2',
            signatoryEmail: 'two@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
            fieldConfig: [],
            status: 'PENDING',
            signedAt: null,
            zohoSignEnvelopeId: 'env-123',
            zohoSignRecipientId: 'a2',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      moveContractToInSignature: jest.fn().mockResolvedValue(undefined),
      deleteSigningPreparationDraft: jest.fn().mockResolvedValue(undefined),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn(),
    }

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => 'application/pdf' },
    } as unknown as Response)

    const signatureProvider = {
      createSigningEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'env-123',
        recipients: [
          { email: 'one@nxtwave.co.in', recipientId: 'a1', clientUserId: 'c1', signingUrl: '' },
          { email: 'two@nxtwave.co.in', recipientId: 'a2', clientUserId: 'c2', signingUrl: '' },
        ],
      }),
      downloadCompletedEnvelopeDocuments: jest.fn(),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      {
        createSignedDownloadUrl: jest.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed-url',
          fileName: 'contract.pdf',
        }),
      },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      signatureProvider,
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    const result = await service.sendSigningPreparationDraft({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
    })

    expect(result.envelopeId).toBe('env-123')
    expect(signatureProvider.createSigningEnvelope).toHaveBeenCalledTimes(1)
    expect(contractQueryService.addSignatory).toHaveBeenCalledTimes(2)
  })

  it('requires draft to exist before send', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue(null),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      { createSigningEnvelope: jest.fn(), downloadCompletedEnvelopeDocuments: jest.fn() },
      { sendTemplateEmail: jest.fn() },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.sendSigningPreparationDraft({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
      })
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'SIGNING_PREPARATION_DRAFT_NOT_FOUND',
    })
  })

  it('sends draft and locks contract only after envelope creation success', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest
        .fn()
        .mockResolvedValueOnce({
          contractId: 'contract-1',
          recipients: [
            {
              name: 'Internal User',
              email: 'internal@nxtwave.co.in',
              recipientType: 'INTERNAL',
              routingOrder: 1,
            },
            {
              name: 'External User',
              email: 'external@nxtwave.co.in',
              recipientType: 'EXTERNAL',
              routingOrder: 2,
            },
          ],
          fields: [
            {
              fieldType: 'SIGNATURE',
              pageNumber: 1,
              xPosition: 10,
              yPosition: 20,
              anchorString: null,
              assignedSignerEmail: 'internal@nxtwave.co.in',
            },
            {
              fieldType: 'SIGNATURE',
              pageNumber: 1,
              xPosition: 20,
              yPosition: 30,
              anchorString: null,
              assignedSignerEmail: 'external@nxtwave.co.in',
            },
          ],
        })
        .mockResolvedValueOnce(null),
      getContractDetail: jest
        .fn()
        .mockResolvedValueOnce(mockContractView)
        .mockResolvedValueOnce({
          ...mockContractView,
          contract: {
            ...mockContractView.contract,
            status: 'SIGNING',
          },
          signatories: [
            {
              id: 'sig-1',
              signatoryEmail: 'internal@nxtwave.co.in',
              recipientType: 'INTERNAL',
              routingOrder: 1,
              fieldConfig: [],
              status: 'PENDING',
              signedAt: null,
              zohoSignEnvelopeId: 'env-1',
              zohoSignRecipientId: '1',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'sig-2',
              signatoryEmail: 'external@nxtwave.co.in',
              recipientType: 'EXTERNAL',
              routingOrder: 2,
              fieldConfig: [],
              status: 'PENDING',
              signedAt: null,
              zohoSignEnvelopeId: 'env-1',
              zohoSignRecipientId: '2',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      addSignatory: jest
        .fn()
        .mockResolvedValueOnce({
          ...mockContractView,
          signatories: [
            {
              id: 'sig-1',
              signatoryEmail: 'internal@nxtwave.co.in',
              recipientType: 'INTERNAL',
              routingOrder: 1,
              fieldConfig: [],
              status: 'PENDING',
              signedAt: null,
              zohoSignEnvelopeId: 'env-1',
              zohoSignRecipientId: '1',
              createdAt: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({
          ...mockContractView,
          signatories: [
            {
              id: 'sig-1',
              signatoryEmail: 'internal@nxtwave.co.in',
              recipientType: 'INTERNAL',
              routingOrder: 1,
              fieldConfig: [],
              status: 'PENDING',
              signedAt: null,
              zohoSignEnvelopeId: 'env-1',
              zohoSignRecipientId: '1',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'sig-2',
              signatoryEmail: 'external@nxtwave.co.in',
              recipientType: 'EXTERNAL',
              routingOrder: 2,
              fieldConfig: [],
              status: 'PENDING',
              signedAt: null,
              zohoSignEnvelopeId: 'env-1',
              zohoSignRecipientId: '2',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      moveContractToInSignature: jest.fn().mockResolvedValue(undefined),
      deleteSigningPreparationDraft: jest.fn().mockResolvedValue(undefined),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn(),
    }

    const signatureProvider = {
      createSigningEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'env-1',
        recipients: [
          {
            email: 'internal@nxtwave.co.in',
            recipientId: '1',
            clientUserId: 'c1',
            signingUrl: 'https://zoho-sign.example/internal',
          },
          {
            email: 'external@nxtwave.co.in',
            recipientId: '2',
            clientUserId: 'c2',
            signingUrl: 'https://zoho-sign.example/external',
          },
        ],
      }),
      downloadCompletedEnvelopeDocuments: jest.fn(),
    }

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => 'application/pdf' },
    } as unknown as Response)

    const service = new ContractSignatoryService(
      contractQueryService as never,
      {
        createSignedDownloadUrl: jest.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed-url',
          fileName: 'contract.pdf',
        }),
      },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      signatureProvider,
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    const result = await service.sendSigningPreparationDraft({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
    })

    expect(result.envelopeId).toBe('env-1')
    expect(signatureProvider.createSigningEnvelope).toHaveBeenCalledTimes(1)
    expect(contractQueryService.moveContractToInSignature).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
      envelopeId: 'env-1',
    })
    expect(contractQueryService.deleteSigningPreparationDraft).not.toHaveBeenCalled()
  })

  it('persists all recipients for mixed embedded and external envelopes', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue({
        contractId: 'contract-1',
        recipients: [
          { name: 'Ext One', email: 'ext1@example.com', recipientType: 'EXTERNAL', routingOrder: 1 },
          { name: 'Int One', email: 'int@example.com', recipientType: 'INTERNAL', routingOrder: 2 },
          { name: 'Ext Two', email: 'ext2@example.com', recipientType: 'EXTERNAL', routingOrder: 3 },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 10,
            yPosition: 20,
            anchorString: null,
            assignedSignerEmail: 'ext1@example.com',
          },
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 15,
            yPosition: 25,
            anchorString: null,
            assignedSignerEmail: 'int@example.com',
          },
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 20,
            yPosition: 30,
            anchorString: null,
            assignedSignerEmail: 'ext2@example.com',
          },
        ],
      }),
      getContractDetail: jest.fn().mockResolvedValue({
        ...mockContractView,
        contract: { ...mockContractView.contract, currentDocumentId: 'doc-1' },
      }),
      addSignatory: jest.fn().mockResolvedValue({
        ...mockContractView,
        signatories: [
          {
            id: 'sig-1',
            signatoryEmail: 'ext1@example.com',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
            fieldConfig: [],
            status: 'PENDING',
            signedAt: null,
            zohoSignEnvelopeId: 'env-123',
            zohoSignRecipientId: 'a1',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'sig-2',
            signatoryEmail: 'int@example.com',
            recipientType: 'INTERNAL',
            routingOrder: 2,
            fieldConfig: [],
            status: 'PENDING',
            signedAt: null,
            zohoSignEnvelopeId: 'env-123',
            zohoSignRecipientId: 'a2',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'sig-3',
            signatoryEmail: 'ext2@example.com',
            recipientType: 'EXTERNAL',
            routingOrder: 3,
            fieldConfig: [],
            status: 'PENDING',
            signedAt: null,
            zohoSignEnvelopeId: 'env-123',
            zohoSignRecipientId: 'a3',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      moveContractToInSignature: jest.fn().mockResolvedValue(undefined),
      deleteSigningPreparationDraft: jest.fn().mockResolvedValue(undefined),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn(),
    }

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => 'application/pdf' },
    } as unknown as Response)

    const signatureProvider = {
      createSigningEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'env-123',
        recipients: [
          { email: 'ext1@example.com', recipientId: 'a1', clientUserId: 'c1', signingUrl: '' },
          { email: 'int@example.com', recipientId: 'a2', clientUserId: 'c2', signingUrl: '' },
          { email: 'ext2@example.com', recipientId: 'a3', clientUserId: 'c3', signingUrl: '' },
        ],
      }),
      downloadCompletedEnvelopeDocuments: jest.fn(),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      {
        createSignedDownloadUrl: jest.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed-url',
          fileName: 'contract.pdf',
        }),
      },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      signatureProvider,
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await service.sendSigningPreparationDraft({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
    })

    expect(signatureProvider.createSigningEnvelope).toHaveBeenCalledTimes(1)
    expect(signatureProvider.createSigningEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: [
          expect.objectContaining({ email: 'ext1@example.com', name: 'Ext One' }),
          expect.objectContaining({ email: 'int@example.com', name: 'Int One' }),
          expect.objectContaining({ email: 'ext2@example.com', name: 'Ext Two' }),
        ],
      })
    )
    expect(contractQueryService.addSignatory).toHaveBeenCalledTimes(3)
    expect(contractQueryService.addSignatory).toHaveBeenCalledWith(
      expect.objectContaining({
        signatoryEmail: 'ext1@example.com',
        zohoSignRecipientId: 'a1',
      })
    )
    expect(contractQueryService.addSignatory).toHaveBeenCalledWith(
      expect.objectContaining({
        signatoryEmail: 'int@example.com',
        zohoSignRecipientId: 'a2',
      })
    )
    expect(contractQueryService.addSignatory).toHaveBeenCalledWith(
      expect.objectContaining({
        signatoryEmail: 'ext2@example.com',
        zohoSignRecipientId: 'a3',
      })
    )
  })

  it('fails when Zoho response omits a recipient mapping', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue({
        contractId: 'contract-1',
        recipients: [
          { name: 'Ext One', email: 'ext1@example.com', recipientType: 'EXTERNAL', routingOrder: 1 },
          { name: 'Int One', email: 'int@example.com', recipientType: 'INTERNAL', routingOrder: 2 },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 10,
            yPosition: 20,
            anchorString: null,
            assignedSignerEmail: 'ext1@example.com',
          },
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 15,
            yPosition: 25,
            anchorString: null,
            assignedSignerEmail: 'int@example.com',
          },
        ],
      }),
      getContractDetail: jest.fn().mockResolvedValue({
        ...mockContractView,
        contract: { ...mockContractView.contract, currentDocumentId: 'doc-1' },
      }),
      addSignatory: jest.fn().mockResolvedValue(mockContractView),
      moveContractToInSignature: jest.fn().mockResolvedValue(undefined),
      deleteSigningPreparationDraft: jest.fn().mockResolvedValue(undefined),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn(),
    }

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => 'application/pdf' },
    } as unknown as Response)

    const signatureProvider = {
      createSigningEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'env-123',
        recipients: [
          { email: 'ext1@example.com', recipientId: 'a1', clientUserId: 'c1', signingUrl: '' },
          // Missing int@example.com mapping
        ],
      }),
      downloadCompletedEnvelopeDocuments: jest.fn(),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      {
        createSignedDownloadUrl: jest.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed-url',
          fileName: 'contract.pdf',
        }),
      },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      signatureProvider,
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.sendSigningPreparationDraft({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
      })
    ).rejects.toBeInstanceOf(ExternalServiceError)

    expect(contractQueryService.moveContractToInSignature).not.toHaveBeenCalled()
    expect(contractQueryService.deleteSigningPreparationDraft).not.toHaveBeenCalled()
  })

  it('rejects duplicate send attempts when pending signatories already exist', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(1),
      getContractDetail: jest.fn().mockResolvedValue({
        contract: { status: 'SIGNING' },
      }),
      softResetActiveSigningCycle: jest.fn(),
      getSigningPreparationDraft: jest.fn(),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      { createSigningEnvelope: jest.fn(), downloadCompletedEnvelopeDocuments: jest.fn() },
      { sendTemplateEmail: jest.fn() },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.sendSigningPreparationDraft({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
      })
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'SIGNING_PREPARATION_ALREADY_SENT',
    })

    expect(contractQueryService.softResetActiveSigningCycle).not.toHaveBeenCalled()
    expect(contractQueryService.getSigningPreparationDraft).not.toHaveBeenCalled()
  })

  it('allows resend by soft-resetting stale pending signatories in COMPLETED', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      getContractDetail: jest.fn().mockResolvedValue({
        ...createContractView(),
        contract: {
          ...createContractView().contract,
          status: 'COMPLETED',
        },
      }),
      softResetActiveSigningCycle: jest.fn().mockResolvedValue(undefined),
      getSigningPreparationDraft: jest.fn().mockResolvedValue({
        contractId: 'contract-1',
        recipients: [
          {
            name: 'Signer',
            email: 'signer@example.com',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 10,
            yPosition: 10,
            anchorString: null,
            assignedSignerEmail: 'signer@example.com',
          },
        ],
      }),
      addSignatory: jest.fn().mockResolvedValue({
        ...createContractView(),
        signatories: [
          {
            signatoryEmail: 'signer@example.com',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
            zohoSignEnvelopeId: 'env-soft-reset',
          },
        ],
      }),
      moveContractToInSignature: jest.fn(),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      getEnvelopeNotificationProfile: jest.fn().mockResolvedValue({
        contractTitle: 'Master Service Agreement',
        recipientEmails: ['signer@example.com'],
      }),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getContractDocumentsBySystem: jest.fn().mockResolvedValue([]),
      markSignatoryAsSigned: jest.fn(),
    }

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => 'application/pdf' },
    } as unknown as Response)

    const signatureProvider = {
      createSigningEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'env-soft-reset',
        recipients: [{ email: 'signer@example.com', recipientId: 'recipient-1', routingOrder: 1 }],
        sourceDocumentId: 'source-doc-1',
      }),
      downloadCompletedEnvelopeDocuments: jest.fn(),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      {
        createSignedDownloadUrl: jest.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed-url',
          fileName: 'contract.pdf',
        }),
      },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      signatureProvider,
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      createLogger(),
      { findStampBytes: jest.fn() }
    )

    const result = await service.sendSigningPreparationDraft({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
    })

    expect(result.envelopeId).toBe('env-soft-reset')
    expect(contractQueryService.softResetActiveSigningCycle).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legal@nxtwave.co.in',
    })
    expect(contractQueryService.moveContractToInSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        envelopeId: 'env-soft-reset',
      })
    )
  })

  it('keeps contract editable when envelope creation fails during send', async () => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue({
        contractId: 'contract-1',
        recipients: [
          {
            name: 'External User',
            email: 'external@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [
          {
            fieldType: 'SIGNATURE',
            pageNumber: 1,
            xPosition: 10,
            yPosition: 20,
            anchorString: null,
            assignedSignerEmail: 'external@nxtwave.co.in',
          },
        ],
      }),
      getContractDetail: jest.fn().mockResolvedValue(mockContractView),
      addSignatory: jest.fn(),
      moveContractToInSignature: jest.fn(),
      deleteSigningPreparationDraft: jest.fn(),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn(),
    }

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => 'application/pdf' },
    } as unknown as Response)

    const service = new ContractSignatoryService(
      contractQueryService as never,
      {
        createSignedDownloadUrl: jest.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed-url',
          fileName: 'contract.pdf',
        }),
      },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      {
        createSigningEnvelope: jest.fn().mockRejectedValue(new Error('Zoho Sign unavailable')),
        downloadCompletedEnvelopeDocuments: jest.fn(),
      },
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.sendSigningPreparationDraft({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
      })
    ).rejects.toBeInstanceOf(ExternalServiceError)

    expect(contractQueryService.moveContractToInSignature).not.toHaveBeenCalled()
    expect(contractQueryService.deleteSigningPreparationDraft).not.toHaveBeenCalled()
  })

  // ── Task 8 Feature B: relax Legal/Admin-only gate on downloadFinalSigningArtifact ──

  it('delegates access decision to getContractDetail for non-LEGAL roles (POC/HOD)', async () => {
    // Strategy: mock getContractDetail to throw CONTRACT_READ_FORBIDDEN, then assert that
    // a POC call propagates that error rather than the old CONTRACT_SIGNATORY_FORBIDDEN.
    // This proves the Legal/Admin-only gate is gone and access is now decided by getContractDetail.
    const readForbiddenError = new AuthorizationError('CONTRACT_READ_FORBIDDEN', 'Not your contract')

    const contractQueryService = {
      getContractDetail: jest.fn().mockRejectedValue(readForbiddenError),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      { createSigningEnvelope: jest.fn(), downloadCompletedEnvelopeDocuments: jest.fn() },
      { sendTemplateEmail: jest.fn() },
      { signatoryLinkTemplateId: 101, signingCompletedTemplateId: 102 },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.downloadFinalSigningArtifact({
        tenantId: 't1',
        contractId: 'c-1',
        actorEmployeeId: 'poc-emp-1',
        actorRole: 'POC',
        artifact: 'signed_document',
      })
    ).rejects.toMatchObject({ code: 'CONTRACT_READ_FORBIDDEN' })

    // getContractDetail must have been called (proving we reached it, not the old role gate)
    expect(contractQueryService.getContractDetail).toHaveBeenCalledWith({
      tenantId: 't1',
      contractId: 'c-1',
      employeeId: 'poc-emp-1',
      role: 'POC',
    })
  })

  it('still rejects when actorRole is missing (no role at all)', async () => {
    const service = new ContractSignatoryService(
      { getContractDetail: jest.fn() } as never,
      { createSignedDownloadUrl: jest.fn() },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      { createSigningEnvelope: jest.fn(), downloadCompletedEnvelopeDocuments: jest.fn() },
      { sendTemplateEmail: jest.fn() },
      { signatoryLinkTemplateId: 101, signingCompletedTemplateId: 102 },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { findStampBytes: jest.fn() }
    )

    await expect(
      service.downloadFinalSigningArtifact({
        tenantId: 't1',
        contractId: 'c-1',
        actorEmployeeId: 'emp-1',
        artifact: 'signed_document',
      } as never)
    ).rejects.toMatchObject({ code: 'CONTRACT_SIGNATORY_FORBIDDEN' })
  })
})

describe('static field handling', () => {
  // A 1x1 PNG. pdf-lib must be able to actually embed this, so the flatten path
  // in these tests exercises real rendering rather than a stubbed renderer.
  const stampPngBytes = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  )

  const createSinglePagePdf = async (): Promise<Uint8Array> => {
    const pdf = await PDFDocument.create()
    pdf.addPage([612, 792])
    return await pdf.save()
  }

  type DraftField = {
    fieldType: string
    pageNumber: number
    xPosition: number
    yPosition: number
    width: number
    height: number
    anchorString: null
    assignedSignerEmail: string
    textValue?: string
  }

  const buildSendHarness = async (options: {
    fields: DraftField[]
    fileName?: string
    contentType?: string
    documentBytes?: Uint8Array
    stampBytes?: Uint8Array
  }) => {
    const contractQueryService = {
      countPendingSignatoriesByContract: jest.fn().mockResolvedValue(0),
      getSigningPreparationDraft: jest.fn().mockResolvedValue({
        contractId: 'contract-1',
        recipients: [{ name: 'Signer One', email: 'one@nxtwave.co.in', recipientType: 'EXTERNAL', routingOrder: 1 }],
        fields: options.fields,
      }),
      getContractDetail: jest.fn().mockResolvedValue({
        ...mockContractView,
        contract: { ...mockContractView.contract, currentDocumentId: 'doc-1' },
      }),
      addSignatory: jest.fn().mockResolvedValue({
        ...mockContractView,
        signatories: [
          {
            id: 'sig-1',
            signatoryEmail: 'one@nxtwave.co.in',
            recipientType: 'EXTERNAL',
            routingOrder: 1,
            fieldConfig: [],
            status: 'PENDING',
            signedAt: null,
            zohoSignEnvelopeId: 'env-static-1',
            zohoSignRecipientId: 'a1',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      moveContractToInSignature: jest.fn().mockResolvedValue(undefined),
      deleteSigningPreparationDraft: jest.fn().mockResolvedValue(undefined),
      resolveEnvelopeContext: jest.fn(),
      recordZohoSignWebhookEvent: jest.fn(),
      addSignatoryWebhookAuditEvent: jest.fn(),
      recordContractNotificationDelivery: jest.fn().mockResolvedValue(undefined),
      getEnvelopeNotificationProfile: jest.fn(),
    }

    const documentBytes = options.documentBytes ?? (await createSinglePagePdf())

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => documentBytes.buffer,
      headers: { get: () => options.contentType ?? 'application/pdf' },
    } as unknown as Response)

    const signatureProvider = {
      createSigningEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'env-static-1',
        recipients: [{ email: 'one@nxtwave.co.in', recipientId: 'a1', clientUserId: 'c1', signingUrl: '' }],
      }),
      downloadCompletedEnvelopeDocuments: jest.fn(),
    }

    const orgAssetRepository = {
      findStampBytes: jest.fn().mockResolvedValue(options.stampBytes ?? stampPngBytes),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      {
        createSignedDownloadUrl: jest.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed-url',
          fileName: options.fileName ?? 'contract.pdf',
        }),
      },
      { createDocument: jest.fn() } as never,
      { upload: jest.fn() } as never,
      signatureProvider,
      { sendTemplateEmail: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }) },
      {
        signatoryLinkTemplateId: 101,
        signingCompletedTemplateId: 102,
      },
      'https://app.example.com',
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      orgAssetRepository
    )

    const send = () =>
      service.sendSigningPreparationDraft({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        actorEmail: 'legal@nxtwave.co.in',
      })

    return { service, send, signatureProvider, orgAssetRepository, documentBytes }
  }

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('excludes STAMP and TEXT from the fields sent to Zoho', async () => {
    const { send, signatureProvider, orgAssetRepository } = await buildSendHarness({
      fields: [
        {
          fieldType: 'SIGNATURE',
          pageNumber: 1,
          xPosition: 10,
          yPosition: 20,
          width: 96,
          height: 22,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
        {
          fieldType: 'STAMP',
          pageNumber: 1,
          xPosition: 100,
          yPosition: 200,
          width: 80,
          height: 80,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 200,
          yPosition: 300,
          width: 200,
          height: 40,
          anchorString: null,
          // An empty TEXT field is now rejected by the renderer, so this
          // fixture must carry real text to exercise the filtering it is about.
          textValue: 'Authorised signatory',
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
      ],
    })

    await send()

    const sentFields = signatureProvider.createSigningEnvelope.mock.calls[0][0].recipients[0].fields
    expect(sentFields.map((field: { fieldType: string }) => field.fieldType)).toEqual(['SIGNATURE'])
    // The stamp must have been fetched and burned in, not silently skipped.
    expect(orgAssetRepository.findStampBytes).toHaveBeenCalledWith('tenant-1')
  })

  it('sends flattened bytes to Zoho rather than the original document', async () => {
    const { send, signatureProvider, documentBytes } = await buildSendHarness({
      fields: [
        {
          fieldType: 'SIGNATURE',
          pageNumber: 1,
          xPosition: 10,
          yPosition: 20,
          width: 96,
          height: 22,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
        {
          fieldType: 'STAMP',
          pageNumber: 1,
          xPosition: 100,
          yPosition: 200,
          width: 80,
          height: 80,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
      ],
    })

    await send()

    const sentBytes = signatureProvider.createSigningEnvelope.mock.calls[0][0].documentBytes as Uint8Array
    // A real flatten embeds the stamp XObject, so the payload must differ from
    // the source PDF. Same-length bytes would mean the flatten never landed.
    expect(sentBytes.byteLength).not.toBe(documentBytes.byteLength)
    const reloaded = await PDFDocument.load(sentBytes)
    expect(reloaded.getPages()).toHaveLength(1)
  })

  it('rejects a recipient whose only fields are STAMP and TEXT', async () => {
    const { send } = await buildSendHarness({
      fields: [
        {
          fieldType: 'STAMP',
          pageNumber: 1,
          xPosition: 100,
          yPosition: 200,
          width: 80,
          height: 80,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 200,
          yPosition: 300,
          width: 200,
          height: 40,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
      ],
    })

    await expect(send()).rejects.toThrow('SIGNATURE field is required')
  })

  // The draft stores textValue; assignSignatory reads text_value. If the
  // recipientFields map in sendSigningPreparationDraft drops the property, TEXT
  // fields flatten to an empty box and nothing anywhere reports a problem.
  // These two tests pin that hand-off from both directions.
  it('carries textValue from the loaded draft through to the flattened document', async () => {
    const { send, signatureProvider } = await buildSendHarness({
      fields: [
        {
          fieldType: 'SIGNATURE',
          pageNumber: 1,
          xPosition: 10,
          yPosition: 20,
          width: 96,
          height: 22,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 200,
          yPosition: 300,
          width: 300,
          height: 40,
          anchorString: null,
          textValue: 'Executed under common seal',
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
      ],
    })

    await send()

    const sentBytes = signatureProvider.createSigningEnvelope.mock.calls[0][0].documentBytes as Uint8Array
    const reloaded = await PDFDocument.load(sentBytes)
    expect(reloaded.getPages()).toHaveLength(1)

    // The exact glyphs must appear in the page's show-text operator. A dropped
    // text_value still embeds the font and still changes the byte length, so
    // only this assertion can distinguish drawn text from a silent no-op.
    const contentStream = await readPageContentStream(sentBytes, 0)
    expect(contentStream).toContain(`<${toPdfHexString('Executed under common seal')}> Tj`)
  })

  it('surfaces the renderer page-bottom error, proving the text reached the renderer', async () => {
    const { send } = await buildSendHarness({
      fields: [
        {
          fieldType: 'SIGNATURE',
          pageNumber: 1,
          xPosition: 10,
          yPosition: 20,
          width: 96,
          height: 22,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 200,
          // 12pt above the bottom of a 792pt page: not even one 13.2pt line fits,
          // and the box cannot grow downward past the page edge.
          yPosition: 780,
          width: 40,
          height: 14,
          anchorString: null,
          textValue: 'this is a great deal more text than can possibly fit inside forty points',
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
      ],
    })

    // A dropped text_value would render nothing and let the send succeed, so
    // this rejection is only reachable when the value survives the hand-off.
    await expect(send()).rejects.toThrow('before the bottom of the page')
  })

  it('sends text that outgrows its stored box height instead of blocking', async () => {
    const { send } = await buildSendHarness({
      fields: [
        {
          fieldType: 'SIGNATURE',
          pageNumber: 1,
          xPosition: 10,
          yPosition: 20,
          width: 96,
          height: 22,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          xPosition: 200,
          yPosition: 300,
          // A 14pt box holds one line; this text needs many. It used to block
          // the send, which is the restriction Legal hit on ordinary clauses.
          width: 40,
          height: 14,
          anchorString: null,
          textValue: 'this is a great deal more text than can possibly fit inside forty points',
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
      ],
    })

    await expect(send()).resolves.toBeTruthy()
  })

  it('throws when the document is not a PDF and static fields are present', async () => {
    const { send, signatureProvider } = await buildSendHarness({
      fields: [
        {
          fieldType: 'SIGNATURE',
          pageNumber: 1,
          xPosition: 10,
          yPosition: 20,
          width: 96,
          height: 22,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
        {
          fieldType: 'STAMP',
          pageNumber: 1,
          xPosition: 100,
          yPosition: 200,
          width: 80,
          height: 80,
          anchorString: null,
          assignedSignerEmail: 'one@nxtwave.co.in',
        },
      ],
      fileName: 'contract.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      documentBytes: new Uint8Array([1, 2, 3]),
    })

    await expect(send()).rejects.toThrow(/PDF/i)
    // Nothing may reach Zoho once we know the stamp cannot be burned in.
    expect(signatureProvider.createSigningEnvelope).not.toHaveBeenCalled()
  })
})

describe('downloadFinalSigningArtifact naming', () => {
  const signedSignatories = [
    {
      zohoSignEnvelopeId: 'env-1',
      status: 'SIGNED',
      signedAt: '2026-07-19T10:00:00.000Z',
    },
    {
      zohoSignEnvelopeId: 'env-1',
      status: 'SIGNED',
      signedAt: '2026-07-20T09:30:00.000Z',
    },
  ]

  const executedDocument = {
    id: 'doc-executed',
    documentKind: 'EXECUTED_CONTRACT',
    fileName: 'executed-env-1.pdf',
    downloadFileName: 'MSA - Acme Corp - Signed - 20-07-2026.pdf',
    createdAt: '2026-07-20T10:00:00.000Z',
  }

  const buildService = (overrides: {
    documents?: unknown[]
    createSignedDownloadUrl?: jest.Mock
    storageSignedDownloadUrl?: jest.Mock
  }) => {
    const contractQueryService = {
      getContractDetail: jest.fn().mockResolvedValue({
        contract: { id: 'contract-1', title: 'MSA - Acme Corp', status: 'COMPLETED' },
        documents: overrides.documents ?? [],
        availableActions: [],
        additionalApprovers: [],
        signatories: signedSignatories,
      }),
    }

    const contractDocumentDownloadService = {
      createSignedDownloadUrl:
        overrides.createSignedDownloadUrl ??
        jest.fn().mockResolvedValue({
          signedUrl: 'https://storage.example.com/signed',
          fileName: 'executed-env-1.pdf',
        }),
    }

    const contractStorageRepository = {
      upload: jest.fn(),
      createSignedDownloadUrl:
        overrides.storageSignedDownloadUrl ?? jest.fn().mockRejectedValue(new Error('merged artifact not in storage')),
    }
    const contractRepository = { createDocument: jest.fn() }

    const signatureProvider = {
      createSigningEnvelope: jest.fn(),
      downloadEnvelopePdf: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      downloadCompletionCertificate: jest.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    }

    const service = new ContractSignatoryService(
      contractQueryService as never,
      contractDocumentDownloadService as never,
      contractRepository as never,
      contractStorageRepository as never,
      signatureProvider as never,
      { sendTemplateEmail: jest.fn() },
      { signatoryLinkTemplateId: 101, signingCompletedTemplateId: 102 },
      'https://app.example.com',
      createLogger(),
      { findStampBytes: jest.fn() }
    )

    return { service, contractDocumentDownloadService, contractStorageRepository }
  }

  it('returns the friendly filename when served from storage', async () => {
    const { service } = buildService({ documents: [executedDocument] })

    const result = await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'signed_document',
    })

    expect(result.fileName).toBe('MSA - Acme Corp - Signed - 20-07-2026.pdf')
  })

  it('passes the friendly filename to the signed URL so Content-Disposition carries it', async () => {
    const { service, contractDocumentDownloadService } = buildService({
      documents: [executedDocument],
    })

    await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'signed_document',
    })

    expect(contractDocumentDownloadService.createSignedDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadFileName: 'MSA - Acme Corp - Signed - 20-07-2026.pdf',
      })
    )
  })

  it('returns the friendly filename when falling back to Zoho', async () => {
    const { service } = buildService({ documents: [] })

    const result = await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'signed_document',
    })

    expect(result.fileName).toBe('MSA - Acme Corp - Signed - 20-07-2026.pdf')
  })

  it('still stores the artifact under its internal path', async () => {
    const { service, contractStorageRepository } = buildService({ documents: [] })

    await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'signed_document',
    })

    expect(contractStorageRepository.upload).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/executed/') })
    )
  })

  it('names the completion certificate with its own suffix', async () => {
    const { service } = buildService({ documents: [] })

    const result = await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'completion_certificate',
    })

    expect(result.fileName).toBe('MSA - Acme Corp - Completion Certificate - 20-07-2026.pdf')
  })

  // Without the friendly name Supabase omits Content-Disposition: attachment,
  // so the browser renders the merged PDF inline under its storage key instead
  // of downloading it.
  it('forces an attachment with the friendly name on the merged artifact served from storage', async () => {
    const storageSignedDownloadUrl = jest.fn().mockResolvedValue('https://storage.example.com/merged?token=abc')
    const { service, contractStorageRepository } = buildService({
      documents: [],
      storageSignedDownloadUrl,
    })

    const result = await service.downloadFinalSigningArtifact({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      artifact: 'merged_pdf',
    })

    expect(contractStorageRepository.createSignedDownloadUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      'MSA - Acme Corp - Signed with Certificate - 20-07-2026.pdf'
    )
    expect(result.fileName).toBe('MSA - Acme Corp - Signed with Certificate - 20-07-2026.pdf')
  })
})
