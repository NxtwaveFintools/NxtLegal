import { AuthorizationError, BusinessRuleError, ExternalServiceError } from '@/core/http/errors'
import type { ContractDetailView } from '@/core/domain/contracts/contract-query-repository'
import type { ContractQueryService } from '@/core/domain/contracts/contract-query-service'

type ContractDocumentDownloadService = {
  createSignedDownloadUrl(params: {
    contractId: string
    tenantId: string
    requestorEmployeeId: string
    requestorRole: string
    documentId?: string
  }): Promise<{ signedUrl: string; fileName: string }>
}

type SignatureProvider = {
  createSigningEnvelope(input: {
    signerEmail: string
    signerName: string
    documentName: string
    documentMimeType: string
    documentBytes: Uint8Array
    emailSubject: string
    returnUrl: string
  }): Promise<{
    envelopeId: string
    recipientId: string
    clientUserId: string
    signingUrl: string
  }>
}

type SignatoryMailer = {
  sendSignatoryLinkEmail(input: { recipientEmail: string; contractTitle: string; signingUrl: string }): Promise<void>
}

type Logger = {
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export class ContractSignatoryService {
  constructor(
    private readonly contractQueryService: ContractQueryService,
    private readonly contractDocumentDownloadService: ContractDocumentDownloadService,
    private readonly signatureProvider: SignatureProvider,
    private readonly signatoryMailer: SignatoryMailer,
    private readonly appSiteUrl: string,
    private readonly logger: Logger
  ) {}

  async assignSignatory(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole?: string
    actorEmail: string
    signatoryEmail: string
  }): Promise<ContractDetailView> {
    if (!params.actorRole) {
      throw new AuthorizationError('CONTRACT_SIGNATORY_FORBIDDEN', 'User role is required for signatory assignment')
    }

    const contractView = await this.contractQueryService.getContractDetail({
      tenantId: params.tenantId,
      contractId: params.contractId,
      employeeId: params.actorEmployeeId,
      role: params.actorRole,
    })

    const download = await this.contractDocumentDownloadService.createSignedDownloadUrl({
      contractId: params.contractId,
      tenantId: params.tenantId,
      requestorEmployeeId: params.actorEmployeeId,
      requestorRole: params.actorRole,
    })

    const documentResponse = await fetch(download.signedUrl)
    if (!documentResponse.ok) {
      throw new BusinessRuleError('CONTRACT_DOCUMENT_FETCH_FAILED', 'Failed to fetch contract document for signing')
    }

    const documentBytes = new Uint8Array(await documentResponse.arrayBuffer())
    const documentMimeType = documentResponse.headers.get('content-type') ?? 'application/octet-stream'

    let envelope: {
      envelopeId: string
      recipientId: string
      clientUserId: string
      signingUrl: string
    }

    try {
      envelope = await this.signatureProvider.createSigningEnvelope({
        signerEmail: params.signatoryEmail,
        signerName: params.signatoryEmail,
        documentName: download.fileName,
        documentMimeType,
        documentBytes,
        emailSubject: `Signature requested for ${contractView.contract.title}`,
        returnUrl: `${this.appSiteUrl}/contracts/${params.contractId}`,
      })
    } catch (error) {
      throw new ExternalServiceError('DOCUSIGN', 'Failed to create DocuSign envelope', error as Error)
    }

    try {
      await this.signatoryMailer.sendSignatoryLinkEmail({
        recipientEmail: params.signatoryEmail,
        contractTitle: contractView.contract.title,
        signingUrl: envelope.signingUrl,
      })
    } catch (error) {
      throw new ExternalServiceError('BREVO', 'Failed to send signatory email', error as Error)
    }

    const updatedView = await this.contractQueryService.addSignatory({
      tenantId: params.tenantId,
      contractId: params.contractId,
      actorEmployeeId: params.actorEmployeeId,
      actorRole: params.actorRole,
      actorEmail: params.actorEmail,
      signatoryEmail: params.signatoryEmail,
      docusignEnvelopeId: envelope.envelopeId,
      docusignRecipientId: envelope.recipientId,
    })

    this.logger.info('Contract signatory assigned', {
      tenantId: params.tenantId,
      contractId: params.contractId,
      signatoryEmail: params.signatoryEmail,
      envelopeId: envelope.envelopeId,
    })

    return updatedView
  }

  async handleDocusignSignedWebhook(params: {
    tenantId: string
    envelopeId: string
    recipientEmail?: string
    status: string
    signedAt?: string
  }): Promise<void> {
    if (params.status.toUpperCase() !== 'COMPLETED') {
      return
    }

    await this.contractQueryService.markSignatoryAsSigned({
      tenantId: params.tenantId,
      envelopeId: params.envelopeId,
      recipientEmail: params.recipientEmail,
      signedAt: params.signedAt,
    })
  }
}
