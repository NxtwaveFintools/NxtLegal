import { randomUUID } from 'crypto'
import {
  contractCounterpartyValues,
  contractDocumentMimeTypes,
  contractDocumentUploadRules,
  type ContractStatus,
  contractUploadModes,
  contractDocumentVersioning,
  contractStatuses,
  contractStorage,
} from '@/core/constants/contracts'
import { limits } from '@/core/constants/limits'
import { AuthorizationError, BusinessRuleError, DatabaseError } from '@/core/http/errors'
import type { ContractRepository } from '@/core/domain/contracts/contract-repository'
import type { ContractStorageRepository } from '@/core/domain/contracts/contract-storage-repository'
import type {
  ContractAccessRecord,
  ContractDocumentAccessRecord,
  ContractDocumentRecord,
  ContractRecord,
} from '@/core/domain/contracts/types'

type Logger = {
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export type UploadContractInput = {
  tenantId: string
  uploadedByEmployeeId: string
  uploadedByEmail: string
  uploadedByRole: string
  uploadMode: 'DEFAULT' | 'LEGAL_SEND_FOR_SIGNING'
  bypassHodApproval?: boolean
  bypassReason?: string
  title: string
  contractTypeId: string
  signatoryName: string
  signatoryDesignation: string
  signatoryEmail: string
  backgroundOfRequest: string
  departmentId: string
  budgetApproved: boolean
  counterpartyName?: string
  counterparties?: Array<{
    counterpartyName: string
    backgroundOfRequest?: string
    budgetApproved?: boolean
    signatories?: Array<{
      name: string
      designation: string
      email: string
    }>
    supportingFiles: Array<{
      fileName: string
      fileSizeBytes: number
      fileMimeType: string
      fileBody: Blob
    }>
  }>
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
  fileBody: Blob
  supportingFiles?: Array<{
    fileName: string
    fileSizeBytes: number
    fileMimeType: string
    fileBody: Blob
  }>
}

export type ReplacePrimaryDocumentInput = {
  tenantId: string
  contractId: string
  uploadedByEmployeeId: string
  uploadedByEmail: string
  uploadedByRole: string
  isFinalExecuted?: boolean
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
  fileBody: Blob
}

export type ReplaceSupportingDocumentInput = {
  tenantId: string
  contractId: string
  sourceDocumentId: string
  uploadedByEmployeeId: string
  uploadedByEmail: string
  uploadedByRole: string
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
  fileBody: Blob
}

type ContractFileMetadata = {
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
}

export type UploadContractMetadataInput = Omit<
  UploadContractInput,
  'fileBody' | 'supportingFiles' | 'counterparties' | 'fileName' | 'fileSizeBytes' | 'fileMimeType'
> & {
  file: ContractFileMetadata
  counterparties?: Array<{
    counterpartyName: string
    backgroundOfRequest?: string
    budgetApproved?: boolean
    signatories?: Array<{
      name: string
      designation: string
      email: string
    }>
    supportingFiles: ContractFileMetadata[]
  }>
  supportingFiles?: ContractFileMetadata[]
}

export type FinalizeContractUploadInput = UploadContractMetadataInput & {
  contractId: string
}

export type ReplacePrimaryDocumentMetadataInput = Omit<ReplacePrimaryDocumentInput, 'fileBody'> & {
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
}

export type ReplaceSupportingDocumentMetadataInput = Omit<ReplaceSupportingDocumentInput, 'fileBody'> & {
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
}

export type PlannedFileUpload = ContractFileMetadata & {
  path: string
  token: string
  signedUrl: string
}

export type InitializeContractUploadResult = {
  contractId: string
  primaryUpload: PlannedFileUpload
  counterpartySupportingUploads: Array<
    PlannedFileUpload & {
      counterpartyIndex: number
      supportingIndex: number
    }
  >
  commonSupportingUploads: Array<
    PlannedFileUpload & {
      supportingIndex: number
    }
  >
}

export type InitializeReplaceMainDocumentResult = {
  upload: PlannedFileUpload
}

export type InitializeReplaceSupportingDocumentResult = {
  upload: PlannedFileUpload
}

export class ContractUploadService {
  private readonly allowedInitialUploadRoles = new Set(contractDocumentUploadRules.initialAllowedRoles)
  private readonly legalReplacementStatuses = new Set<ContractStatus>([
    contractStatuses.pendingInternal,
    contractStatuses.pendingExternal,
    contractStatuses.offlineExecution,
    contractStatuses.onHold,
    contractStatuses.completed,
  ])
  private readonly adminOnlyReplacementStatuses = new Set<ContractStatus>([
    contractStatuses.rejected,
    contractStatuses.void,
  ])
  private readonly privilegedReadRoles = new Set(['ADMIN', 'LEGAL_TEAM'])
  private readonly emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

  constructor(
    private readonly contractRepository: ContractRepository,
    private readonly contractStorageRepository: ContractStorageRepository,
    private readonly logger: Logger
  ) {}

  async uploadContract(input: UploadContractInput): Promise<ContractRecord> {
    this.validateUploadInput(input)

    if (
      !this.allowedInitialUploadRoles.has(
        input.uploadedByRole as (typeof contractDocumentUploadRules.initialAllowedRoles)[number]
      )
    ) {
      throw new AuthorizationError(
        'CONTRACT_UPLOAD_FORBIDDEN',
        'Only POC, HOD, LEGAL_TEAM, or ADMIN can upload initial contracts'
      )
    }

    const isLegalSendForSigning = input.uploadMode === contractUploadModes.legalSendForSigning
    const isLegalOrAdminUpload = input.uploadedByRole === 'LEGAL_TEAM' || input.uploadedByRole === 'ADMIN'

    if (input.uploadedByRole === 'POC') {
      const isPocAssignedToDepartment = await this.contractRepository.isPocAssignedToDepartment({
        tenantId: input.tenantId,
        pocEmail: input.uploadedByEmail,
        departmentId: input.departmentId,
      })

      if (!isPocAssignedToDepartment) {
        throw new AuthorizationError(
          'CONTRACT_UPLOAD_DEPARTMENT_FORBIDDEN',
          'You can upload contracts only for departments assigned to your POC account'
        )
      }
    }

    if (input.uploadedByRole === 'HOD') {
      const isHodAssignedToDepartment = await this.contractRepository.isHodAssignedToDepartment({
        tenantId: input.tenantId,
        hodEmail: input.uploadedByEmail,
        departmentId: input.departmentId,
      })

      if (!isHodAssignedToDepartment) {
        throw new AuthorizationError(
          'CONTRACT_UPLOAD_DEPARTMENT_FORBIDDEN',
          'You can upload contracts only for your assigned HOD department'
        )
      }
    }

    if (isLegalSendForSigning && !isLegalOrAdminUpload) {
      throw new AuthorizationError(
        'CONTRACT_UPLOAD_FORBIDDEN',
        'Only LEGAL_TEAM or ADMIN can use send-for-signing upload mode'
      )
    }

    if (isLegalSendForSigning && input.bypassHodApproval && !input.bypassReason?.trim()) {
      throw new BusinessRuleError('BYPASS_REASON_REQUIRED', 'Bypass reason is required when bypassing HOD approval')
    }

    if (isLegalSendForSigning) {
      if (!this.isPdfUpload(input.fileName, input.fileMimeType)) {
        throw new BusinessRuleError('CONTRACT_FILE_FORMAT_INVALID', 'Legal send-for-signing upload must be a PDF file')
      }
    } else if (!this.isDocxUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError('CONTRACT_FILE_FORMAT_INVALID', 'Initial contract upload must be a DOCX file')
    }

    const contractId = randomUUID()
    const normalizedCounterparties = this.normalizeCounterparties(input)
    const trimmedCounterpartyName = normalizedCounterparties[0]?.counterpartyName ?? ''
    const safeFileName = this.sanitizeFileName(input.fileName)
    const filePath = `${input.tenantId}/${contractId}/${safeFileName}`
    const uploadedSupportingFiles: Array<{
      filePath: string
      fileName: string
      fileSizeBytes: number
      fileMimeType: string
      counterpartySequenceOrder: number | null
      counterpartyName: string | null
    }> = []

    await this.contractStorageRepository.upload({
      path: filePath,
      fileBody: input.fileBody,
      contentType: input.fileMimeType,
    })

    for (const [counterpartyIndex, counterparty] of normalizedCounterparties.entries()) {
      for (const [supportingIndex, supportingFile] of counterparty.supportingFiles.entries()) {
        const safeSupportingFileName = this.sanitizeFileName(supportingFile.fileName)
        const supportingFilePath = `${input.tenantId}/${contractId}/counterparty/${String(counterpartyIndex + 1).padStart(3, '0')}/${String(supportingIndex + 1).padStart(3, '0')}-${safeSupportingFileName}`

        await this.contractStorageRepository.upload({
          path: supportingFilePath,
          fileBody: supportingFile.fileBody,
          contentType: supportingFile.fileMimeType,
        })

        uploadedSupportingFiles.push({
          filePath: supportingFilePath,
          fileName: safeSupportingFileName,
          fileSizeBytes: supportingFile.fileSizeBytes,
          fileMimeType: supportingFile.fileMimeType,
          counterpartySequenceOrder: counterpartyIndex + 1,
          counterpartyName: counterparty.counterpartyName,
        })
      }
    }

    for (const [supportingIndex, supportingFile] of (input.supportingFiles ?? []).entries()) {
      const safeSupportingFileName = this.sanitizeFileName(supportingFile.fileName)
      const supportingFilePath = `${input.tenantId}/${contractId}/supporting/common/${String(supportingIndex + 1).padStart(3, '0')}-${safeSupportingFileName}`

      await this.contractStorageRepository.upload({
        path: supportingFilePath,
        fileBody: supportingFile.fileBody,
        contentType: supportingFile.fileMimeType,
      })

      uploadedSupportingFiles.push({
        filePath: supportingFilePath,
        fileName: safeSupportingFileName,
        fileSizeBytes: supportingFile.fileSizeBytes,
        fileMimeType: supportingFile.fileMimeType,
        counterpartySequenceOrder: null,
        counterpartyName: null,
      })
    }

    let contract: ContractRecord
    try {
      contract = await this.contractRepository.createWithAudit({
        contractId,
        tenantId: input.tenantId,
        title: input.title.trim(),
        contractTypeId: input.contractTypeId,
        signatoryName: input.signatoryName.trim(),
        signatoryDesignation: input.signatoryDesignation.trim(),
        signatoryEmail: input.signatoryEmail.trim().toLowerCase(),
        backgroundOfRequest: input.backgroundOfRequest.trim(),
        departmentId: input.departmentId,
        budgetApproved: input.budgetApproved,
        uploadedByEmployeeId: input.uploadedByEmployeeId,
        uploadedByEmail: input.uploadedByEmail,
        uploadedByRole: input.uploadedByRole,
        uploadMode: input.uploadMode,
        bypassHodApproval: Boolean(input.bypassHodApproval),
        bypassReason: input.bypassReason?.trim() || undefined,
        filePath,
        fileName: safeFileName,
        fileSizeBytes: input.fileSizeBytes,
        fileMimeType: input.fileMimeType,
      })
    } catch (error) {
      try {
        await this.contractStorageRepository.remove(filePath)
        await Promise.all(
          uploadedSupportingFiles.map((supportingFile) =>
            this.contractStorageRepository.remove(supportingFile.filePath)
          )
        )
      } catch (rollbackError) {
        this.logger.error('Contract upload rollback failed', {
          tenantId: input.tenantId,
          contractId,
          filePath,
          rollbackError: String(rollbackError),
        })
      }

      throw new DatabaseError('Failed to initialize contract after upload', error as Error, {
        tenantId: input.tenantId,
        contractId,
      })
    }

    try {
      const createdCounterparties = await this.contractRepository.createCounterparties(
        normalizedCounterparties.map((counterparty, index) => ({
          tenantId: input.tenantId,
          contractId,
          counterpartyName: counterparty.counterpartyName,
          sequenceOrder: index + 1,
        }))
      )

      const counterpartyIdBySequenceOrder = new Map<number, string>()
      for (const counterparty of createdCounterparties) {
        counterpartyIdBySequenceOrder.set(counterparty.sequenceOrder, counterparty.id)
      }

      if (trimmedCounterpartyName) {
        await this.contractRepository.setCounterpartyName({
          tenantId: input.tenantId,
          contractId,
          counterpartyName: trimmedCounterpartyName,
        })
      }

      await this.contractRepository.createDocument({
        tenantId: input.tenantId,
        contractId,
        documentKind: 'PRIMARY',
        versionNumber: contractDocumentVersioning.initialVersion,
        displayName: 'Primary Contract',
        fileName: safeFileName,
        filePath,
        fileSizeBytes: input.fileSizeBytes,
        fileMimeType: input.fileMimeType,
        uploadedByEmployeeId: input.uploadedByEmployeeId,
        uploadedByEmail: input.uploadedByEmail,
        uploadedByRole: input.uploadedByRole,
      })

      for (const [index, supportingFile] of uploadedSupportingFiles.entries()) {
        const displayNameBase = supportingFile.counterpartyName
          ? `Counterparty Docs - ${supportingFile.counterpartyName}`
          : input.budgetApproved
            ? 'Budget Approval Supporting Docs'
            : 'Additional Supporting Docs'

        await this.contractRepository.createDocument({
          tenantId: input.tenantId,
          contractId,
          documentKind: 'COUNTERPARTY_SUPPORTING',
          counterpartyId:
            supportingFile.counterpartySequenceOrder === null
              ? undefined
              : counterpartyIdBySequenceOrder.get(supportingFile.counterpartySequenceOrder),
          displayName: `${displayNameBase} (${index + 1})`,
          fileName: supportingFile.fileName,
          filePath: supportingFile.filePath,
          fileSizeBytes: supportingFile.fileSizeBytes,
          fileMimeType: supportingFile.fileMimeType,
          uploadedByEmployeeId: input.uploadedByEmployeeId,
          uploadedByEmail: input.uploadedByEmail,
        })
      }

      await this.contractRepository.upsertMasterCounterpartyNames({
        tenantId: input.tenantId,
        names: normalizedCounterparties
          .map((counterparty) => counterparty.counterpartyName)
          .filter((name) => name.toUpperCase() !== contractCounterpartyValues.notApplicable),
      })

      const draftRecipients = normalizedCounterparties
        .filter(
          (counterparty) => counterparty.counterpartyName.toUpperCase() !== contractCounterpartyValues.notApplicable
        )
        .flatMap((counterparty, counterpartyIndex) =>
          counterparty.signatories.map((signatory) => ({
            name: signatory.name,
            email: signatory.email,
            designation: signatory.designation,
            counterpartyId: counterpartyIdBySequenceOrder.get(counterpartyIndex + 1),
            counterpartyName: counterparty.counterpartyName,
            backgroundOfRequest: counterparty.backgroundOfRequest,
            budgetApproved: counterparty.budgetApproved,
            recipientType: 'EXTERNAL' as const,
          }))
        )
      const draftRecipientsByEmail = new Map<
        string,
        {
          name: string
          email: string
          designation?: string
          counterpartyId?: string
          counterpartyName?: string
          backgroundOfRequest?: string
          budgetApproved?: boolean
          recipientType: 'INTERNAL' | 'EXTERNAL'
        }
      >()
      for (const recipient of draftRecipients) {
        if (!recipient.email) {
          continue
        }
        if (!draftRecipientsByEmail.has(recipient.email)) {
          draftRecipientsByEmail.set(recipient.email, recipient)
        }
      }

      const seededDraftRecipients = Array.from(draftRecipientsByEmail.values()).map((recipient) => ({
        ...recipient,
        // Default all auto-seeded recipients to parallel signing priority.
        routingOrder: 1,
      }))

      if (seededDraftRecipients.length > 0) {
        try {
          if (typeof this.contractRepository.seedSigningPreparationDraft === 'function') {
            await this.contractRepository.seedSigningPreparationDraft({
              tenantId: input.tenantId,
              contractId,
              actorEmployeeId: input.uploadedByEmployeeId,
              recipients: seededDraftRecipients,
            })
          }
        } catch (error) {
          this.logger.warn('Signing preparation draft seed failed during upload', {
            tenantId: input.tenantId,
            contractId,
            recipientCount: seededDraftRecipients.length,
            error: String(error),
          })
        }
      }
    } catch (error) {
      this.logger.error('Contract document metadata persistence failed', {
        tenantId: input.tenantId,
        contractId,
        error: String(error),
      })

      throw new DatabaseError('Failed to persist contract metadata', error as Error, {
        tenantId: input.tenantId,
        contractId,
      })
    }

    return contract
  }

  async initiateUploadContract(input: UploadContractMetadataInput): Promise<InitializeContractUploadResult> {
    const normalizedInput = this.toUploadMetadataValidationInput(input)
    this.validateUploadMetadataInput(normalizedInput)
    await this.assertInitialUploadPermissions(normalizedInput)
    this.assertInitialUploadFormat(normalizedInput)

    const contractId = randomUUID()
    const uploadPlan = this.buildInitialUploadPlan({
      tenantId: input.tenantId,
      contractId,
      fileName: input.file.fileName,
      fileSizeBytes: input.file.fileSizeBytes,
      fileMimeType: input.file.fileMimeType,
      counterparties: input.counterparties,
      supportingFiles: input.supportingFiles,
    })

    const primarySignedUpload = await this.contractStorageRepository.createSignedUploadUrl(
      uploadPlan.primaryUpload.path
    )
    const counterpartySignedUploads = await Promise.all(
      uploadPlan.counterpartySupportingUploads.map((item) =>
        this.contractStorageRepository.createSignedUploadUrl(item.path)
      )
    )
    const commonSignedUploads = await Promise.all(
      uploadPlan.commonSupportingUploads.map((item) => this.contractStorageRepository.createSignedUploadUrl(item.path))
    )

    return {
      contractId,
      primaryUpload: {
        ...uploadPlan.primaryUpload,
        ...primarySignedUpload,
      },
      counterpartySupportingUploads: uploadPlan.counterpartySupportingUploads.map((item, index) => ({
        ...item,
        ...counterpartySignedUploads[index],
      })),
      commonSupportingUploads: uploadPlan.commonSupportingUploads.map((item, index) => ({
        ...item,
        ...commonSignedUploads[index],
      })),
    }
  }

  async finalizeUploadContract(input: FinalizeContractUploadInput): Promise<ContractRecord> {
    const normalizedInput = this.toUploadMetadataValidationInput(input)
    this.validateUploadMetadataInput(normalizedInput)
    await this.assertInitialUploadPermissions(normalizedInput)
    this.assertInitialUploadFormat(normalizedInput)

    const uploadPlan = this.buildInitialUploadPlan({
      tenantId: input.tenantId,
      contractId: input.contractId,
      fileName: input.file.fileName,
      fileSizeBytes: input.file.fileSizeBytes,
      fileMimeType: input.file.fileMimeType,
      counterparties: input.counterparties,
      supportingFiles: input.supportingFiles,
    })

    await this.assertUploadsExist([
      uploadPlan.primaryUpload.path,
      ...uploadPlan.counterpartySupportingUploads.map((item) => item.path),
      ...uploadPlan.commonSupportingUploads.map((item) => item.path),
    ])

    return this.persistInitialUploadMetadata({
      tenantId: input.tenantId,
      contractId: input.contractId,
      title: input.title,
      contractTypeId: input.contractTypeId,
      signatoryName: input.signatoryName,
      signatoryDesignation: input.signatoryDesignation,
      signatoryEmail: input.signatoryEmail,
      backgroundOfRequest: input.backgroundOfRequest,
      departmentId: input.departmentId,
      budgetApproved: input.budgetApproved,
      uploadedByEmployeeId: input.uploadedByEmployeeId,
      uploadedByEmail: input.uploadedByEmail,
      uploadedByRole: input.uploadedByRole,
      uploadMode: input.uploadMode,
      bypassHodApproval: input.bypassHodApproval,
      bypassReason: input.bypassReason,
      fileName: uploadPlan.primaryUpload.fileName,
      filePath: uploadPlan.primaryUpload.path,
      fileSizeBytes: uploadPlan.primaryUpload.fileSizeBytes,
      fileMimeType: uploadPlan.primaryUpload.fileMimeType,
      normalizedCounterparties: this.normalizeCounterpartiesMetadataInput(normalizedInput),
      uploadedSupportingFiles: [
        ...uploadPlan.counterpartySupportingUploads.map((item) => ({
          filePath: item.path,
          fileName: item.fileName,
          fileSizeBytes: item.fileSizeBytes,
          fileMimeType: item.fileMimeType,
          counterpartySequenceOrder: item.counterpartyIndex + 1,
          counterpartyName: input.counterparties?.[item.counterpartyIndex]?.counterpartyName ?? null,
        })),
        ...uploadPlan.commonSupportingUploads.map((item) => ({
          filePath: item.path,
          fileName: item.fileName,
          fileSizeBytes: item.fileSizeBytes,
          fileMimeType: item.fileMimeType,
          counterpartySequenceOrder: null,
          counterpartyName: null,
        })),
      ],
    })
  }

  async initiateReplacePrimaryDocument(
    input: ReplacePrimaryDocumentMetadataInput
  ): Promise<InitializeReplaceMainDocumentResult> {
    this.validateReplacementInput(input)

    if (!this.isAllowedReplacementUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError('CONTRACT_REPLACEMENT_FILE_FORMAT_INVALID', 'Replacement must be DOCX or PDF')
    }

    const contract = await this.contractRepository.getForAccess(input.contractId, input.tenantId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found for tenant')
    }

    this.assertMainReplacementPermissions(contract, input)
    const safeFileName = this.sanitizeFileName(input.fileName)
    const path = `${input.tenantId}/${input.contractId}/versions/${randomUUID()}-${safeFileName}`
    const signedUpload = await this.contractStorageRepository.createSignedUploadUrl(path)

    return {
      upload: {
        fileName: safeFileName,
        fileSizeBytes: input.fileSizeBytes,
        fileMimeType: input.fileMimeType,
        ...signedUpload,
      },
    }
  }

  async finalizeReplacePrimaryDocument(
    input: ReplacePrimaryDocumentMetadataInput & { path: string }
  ): Promise<ContractDocumentRecord> {
    this.validateReplacementInput(input)

    if (!this.isAllowedReplacementUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError('CONTRACT_REPLACEMENT_FILE_FORMAT_INVALID', 'Replacement must be DOCX or PDF')
    }

    const contract = await this.contractRepository.getForAccess(input.contractId, input.tenantId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found for tenant')
    }

    this.assertMainReplacementPermissions(contract, input)

    const exists = await this.contractStorageRepository.exists(input.path)
    if (!exists) {
      throw new BusinessRuleError(
        'CONTRACT_UPLOAD_INCOMPLETE',
        'Uploaded main replacement file is missing from storage'
      )
    }

    return this.persistPrimaryReplacementMetadata(contract, input)
  }

  async initiateReplaceSupportingDocument(
    input: ReplaceSupportingDocumentMetadataInput
  ): Promise<InitializeReplaceSupportingDocumentResult> {
    this.validateSupportingReplacementInput(input)

    if (!this.isAllowedReplacementUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError('CONTRACT_REPLACEMENT_FILE_FORMAT_INVALID', 'Replacement must be DOCX or PDF')
    }

    const contract = await this.contractRepository.getForAccess(input.contractId, input.tenantId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found for tenant')
    }

    this.assertSupportingReplacementPermissions(contract, input)

    const sourceDocument = await this.contractRepository.getDocumentForAccess({
      tenantId: input.tenantId,
      contractId: input.contractId,
      documentId: input.sourceDocumentId,
    })
    if (!sourceDocument || sourceDocument.documentKind !== 'COUNTERPARTY_SUPPORTING') {
      throw new BusinessRuleError('DOCUMENT_NOT_FOUND', 'Supporting document not found for replacement')
    }

    const safeFileName = this.sanitizeFileName(input.fileName)
    const path = `${input.tenantId}/${input.contractId}/counterparty-replacements/${randomUUID()}-${safeFileName}`
    const signedUpload = await this.contractStorageRepository.createSignedUploadUrl(path)

    return {
      upload: {
        fileName: safeFileName,
        fileSizeBytes: input.fileSizeBytes,
        fileMimeType: input.fileMimeType,
        ...signedUpload,
      },
    }
  }

  async finalizeReplaceSupportingDocument(
    input: ReplaceSupportingDocumentMetadataInput & { path: string }
  ): Promise<void> {
    this.validateSupportingReplacementInput(input)

    if (!this.isAllowedReplacementUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError('CONTRACT_REPLACEMENT_FILE_FORMAT_INVALID', 'Replacement must be DOCX or PDF')
    }

    const contract = await this.contractRepository.getForAccess(input.contractId, input.tenantId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found for tenant')
    }

    this.assertSupportingReplacementPermissions(contract, input)

    const sourceDocument = await this.contractRepository.getDocumentForAccess({
      tenantId: input.tenantId,
      contractId: input.contractId,
      documentId: input.sourceDocumentId,
    })
    if (!sourceDocument || sourceDocument.documentKind !== 'COUNTERPARTY_SUPPORTING') {
      throw new BusinessRuleError('DOCUMENT_NOT_FOUND', 'Supporting document not found for replacement')
    }

    const exists = await this.contractStorageRepository.exists(input.path)
    if (!exists) {
      throw new BusinessRuleError(
        'CONTRACT_UPLOAD_INCOMPLETE',
        'Uploaded supporting replacement file is missing from storage'
      )
    }

    await this.persistSupportingReplacementMetadata(contract, sourceDocument, input)
  }

  async replacePrimaryDocument(input: ReplacePrimaryDocumentInput): Promise<ContractDocumentRecord> {
    this.validateReplacementInput(input)

    if (!this.isAllowedReplacementUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError('CONTRACT_REPLACEMENT_FILE_FORMAT_INVALID', 'Replacement must be DOCX or PDF')
    }

    const contract = await this.contractRepository.getForAccess(input.contractId, input.tenantId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found for tenant')
    }

    this.assertMainReplacementPermissions(contract, input)

    const safeFileName = this.sanitizeFileName(input.fileName)
    const filePath = `${input.tenantId}/${input.contractId}/versions/${randomUUID()}-${safeFileName}`

    await this.contractStorageRepository.upload({
      path: filePath,
      fileBody: input.fileBody,
      contentType: input.fileMimeType,
    })

    try {
      const replaceDocumentPromise = this.contractRepository.replacePrimaryDocument({
        tenantId: input.tenantId,
        contractId: input.contractId,
        fileName: safeFileName,
        filePath,
        fileSizeBytes: input.fileSizeBytes,
        fileMimeType: input.fileMimeType,
        uploadedByEmployeeId: input.uploadedByEmployeeId,
        uploadedByEmail: input.uploadedByEmail,
        uploadedByRole: input.uploadedByRole,
      })

      const targetStatus = this.resolveReplacementTargetStatus({
        currentStatus: contract.status,
        uploadedByRole: input.uploadedByRole,
        isFinalExecuted: input.isFinalExecuted,
      })
      const updateStatusPromise =
        targetStatus !== contract.status
          ? this.contractRepository.updateContractStatus({
              tenantId: input.tenantId,
              contractId: input.contractId,
              status: targetStatus,
            })
          : Promise.resolve()

      const [document] = await Promise.all([replaceDocumentPromise, updateStatusPromise])
      return document
    } catch (error) {
      try {
        await this.contractStorageRepository.remove(filePath)
      } catch (rollbackError) {
        this.logger.error('Contract replacement rollback failed', {
          tenantId: input.tenantId,
          contractId: input.contractId,
          filePath,
          rollbackError: String(rollbackError),
        })
      }

      throw new DatabaseError('Failed to replace main contract document', error as Error, {
        tenantId: input.tenantId,
        contractId: input.contractId,
      })
    }
  }

  async replaceSupportingDocument(input: ReplaceSupportingDocumentInput): Promise<void> {
    this.validateSupportingReplacementInput(input)

    if (!this.isAllowedReplacementUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError('CONTRACT_REPLACEMENT_FILE_FORMAT_INVALID', 'Replacement must be DOCX or PDF')
    }

    const contract = await this.contractRepository.getForAccess(input.contractId, input.tenantId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found for tenant')
    }

    this.assertSupportingReplacementPermissions(contract, input)

    const sourceDocument = await this.contractRepository.getDocumentForAccess({
      tenantId: input.tenantId,
      contractId: input.contractId,
      documentId: input.sourceDocumentId,
    })
    if (!sourceDocument || sourceDocument.documentKind !== 'COUNTERPARTY_SUPPORTING') {
      throw new BusinessRuleError('DOCUMENT_NOT_FOUND', 'Supporting document not found for replacement')
    }

    const safeFileName = this.sanitizeFileName(input.fileName)
    const filePath = `${input.tenantId}/${input.contractId}/counterparty-replacements/${randomUUID()}-${safeFileName}`

    await this.contractStorageRepository.upload({
      path: filePath,
      fileBody: input.fileBody,
      contentType: input.fileMimeType,
    })

    try {
      const replaceDocumentPromise = this.contractRepository.replaceSupportingDocument({
        tenantId: input.tenantId,
        contractId: input.contractId,
        sourceDocumentId: input.sourceDocumentId,
        counterpartyId: sourceDocument.counterpartyId ?? null,
        displayName: sourceDocument.displayName ?? 'Counterparty Supporting Document',
        fileName: safeFileName,
        filePath,
        fileSizeBytes: input.fileSizeBytes,
        fileMimeType: input.fileMimeType,
        uploadedByEmployeeId: input.uploadedByEmployeeId,
        uploadedByEmail: input.uploadedByEmail,
        uploadedByRole: input.uploadedByRole,
      })
      const updateStatusPromise =
        contract.status !== contractStatuses.underReview
          ? this.contractRepository.updateContractStatus({
              tenantId: input.tenantId,
              contractId: input.contractId,
              status: contractStatuses.underReview,
            })
          : Promise.resolve()
      await Promise.all([replaceDocumentPromise, updateStatusPromise])
    } catch (error) {
      try {
        await this.contractStorageRepository.remove(filePath)
      } catch (rollbackError) {
        this.logger.error('Supporting document replacement rollback failed', {
          tenantId: input.tenantId,
          contractId: input.contractId,
          sourceDocumentId: input.sourceDocumentId,
          filePath,
          rollbackError: String(rollbackError),
        })
      }

      throw new DatabaseError('Failed to replace supporting contract document', error as Error, {
        tenantId: input.tenantId,
        contractId: input.contractId,
        sourceDocumentId: input.sourceDocumentId,
      })
    }
  }

  async createSignedDownloadUrl(params: {
    contractId: string
    tenantId: string
    requestorEmployeeId: string
    requestorRole: string
    documentId?: string
  }): Promise<{ signedUrl: string; fileName: string }> {
    const contract = await this.contractRepository.getForAccess(params.contractId, params.tenantId)

    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found for tenant')
    }

    const canRead =
      this.privilegedReadRoles.has(params.requestorRole) ||
      contract.uploadedByEmployeeId === params.requestorEmployeeId ||
      contract.currentAssigneeEmployeeId === params.requestorEmployeeId ||
      (params.requestorRole === 'HOD' &&
        (await this.contractRepository.isUploaderInActorTeam({
          tenantId: params.tenantId,
          actorEmployeeId: params.requestorEmployeeId,
          uploaderEmployeeId: contract.uploadedByEmployeeId,
        })))

    if (!canRead) {
      throw new AuthorizationError('CONTRACT_READ_FORBIDDEN', 'You do not have access to this contract')
    }

    if (params.documentId) {
      const document = await this.contractRepository.getDocumentForAccess({
        tenantId: params.tenantId,
        contractId: params.contractId,
        documentId: params.documentId,
      })

      if (!document) {
        throw new BusinessRuleError('DOCUMENT_NOT_FOUND', 'Requested document is not available for this contract')
      }

      const signedUrl = await this.contractStorageRepository.createSignedDownloadUrl(
        document.filePath,
        contractStorage.signedUrlExpirySeconds
      )

      return {
        signedUrl,
        fileName: document.fileName,
      }
    }

    if (!contract.currentDocumentId || contract.currentDocumentId.trim().length === 0) {
      throw new BusinessRuleError('CONTRACT_CURRENT_DOCUMENT_MISSING', 'Active contract document is missing')
    }

    const activeDocument = await this.contractRepository.getDocumentForAccess({
      tenantId: params.tenantId,
      contractId: params.contractId,
      documentId: contract.currentDocumentId,
    })

    if (!activeDocument) {
      throw new BusinessRuleError('CONTRACT_CURRENT_DOCUMENT_INVALID', 'Active contract document could not be resolved')
    }

    const signedUrl = await this.contractStorageRepository.createSignedDownloadUrl(
      activeDocument.filePath,
      contractStorage.signedUrlExpirySeconds
    )

    return {
      signedUrl,
      fileName: activeDocument.fileName,
    }
  }

  private toUploadMetadataValidationInput(
    input: UploadContractMetadataInput | FinalizeContractUploadInput
  ): UploadContractInput {
    return {
      tenantId: input.tenantId,
      uploadedByEmployeeId: input.uploadedByEmployeeId,
      uploadedByEmail: input.uploadedByEmail,
      uploadedByRole: input.uploadedByRole,
      uploadMode: input.uploadMode,
      bypassHodApproval: input.bypassHodApproval,
      bypassReason: input.bypassReason,
      title: input.title,
      contractTypeId: input.contractTypeId,
      signatoryName: input.signatoryName,
      signatoryDesignation: input.signatoryDesignation,
      signatoryEmail: input.signatoryEmail,
      backgroundOfRequest: input.backgroundOfRequest,
      departmentId: input.departmentId,
      budgetApproved: input.budgetApproved,
      counterpartyName: input.counterpartyName,
      counterparties: input.counterparties?.map((counterparty) => ({
        ...counterparty,
        supportingFiles: counterparty.supportingFiles.map((file) => ({
          ...file,
          fileBody: new Blob(),
        })),
      })),
      fileName: input.file.fileName,
      fileSizeBytes: input.file.fileSizeBytes,
      fileMimeType: input.file.fileMimeType,
      fileBody: new Blob(),
      supportingFiles: (input.supportingFiles ?? []).map((file) => ({
        ...file,
        fileBody: new Blob(),
      })),
    }
  }

  private validateUploadMetadataInput(input: UploadContractInput): void {
    this.validateUploadInput(input)
  }

  private async assertInitialUploadPermissions(input: UploadContractInput): Promise<void> {
    if (
      !this.allowedInitialUploadRoles.has(
        input.uploadedByRole as (typeof contractDocumentUploadRules.initialAllowedRoles)[number]
      )
    ) {
      throw new AuthorizationError(
        'CONTRACT_UPLOAD_FORBIDDEN',
        'Only POC, HOD, LEGAL_TEAM, or ADMIN can upload initial contracts'
      )
    }

    const isLegalSendForSigning = input.uploadMode === contractUploadModes.legalSendForSigning
    const isLegalOrAdminUpload = input.uploadedByRole === 'LEGAL_TEAM' || input.uploadedByRole === 'ADMIN'

    if (input.uploadedByRole === 'POC') {
      const isPocAssignedToDepartment = await this.contractRepository.isPocAssignedToDepartment({
        tenantId: input.tenantId,
        pocEmail: input.uploadedByEmail,
        departmentId: input.departmentId,
      })

      if (!isPocAssignedToDepartment) {
        throw new AuthorizationError(
          'CONTRACT_UPLOAD_DEPARTMENT_FORBIDDEN',
          'You can upload contracts only for departments assigned to your POC account'
        )
      }
    }

    if (input.uploadedByRole === 'HOD') {
      const isHodAssignedToDepartment = await this.contractRepository.isHodAssignedToDepartment({
        tenantId: input.tenantId,
        hodEmail: input.uploadedByEmail,
        departmentId: input.departmentId,
      })

      if (!isHodAssignedToDepartment) {
        throw new AuthorizationError(
          'CONTRACT_UPLOAD_DEPARTMENT_FORBIDDEN',
          'You can upload contracts only for your assigned HOD department'
        )
      }
    }

    if (isLegalSendForSigning && !isLegalOrAdminUpload) {
      throw new AuthorizationError(
        'CONTRACT_UPLOAD_FORBIDDEN',
        'Only LEGAL_TEAM or ADMIN can use send-for-signing upload mode'
      )
    }

    if (isLegalSendForSigning && input.bypassHodApproval && !input.bypassReason?.trim()) {
      throw new BusinessRuleError('BYPASS_REASON_REQUIRED', 'Bypass reason is required when bypassing HOD approval')
    }
  }

  private assertInitialUploadFormat(input: UploadContractInput): void {
    const isLegalSendForSigning = input.uploadMode === contractUploadModes.legalSendForSigning
    if (isLegalSendForSigning) {
      if (!this.isPdfUpload(input.fileName, input.fileMimeType)) {
        throw new BusinessRuleError('CONTRACT_FILE_FORMAT_INVALID', 'Legal send-for-signing upload must be a PDF file')
      }
      return
    }

    if (!this.isDocxUpload(input.fileName, input.fileMimeType)) {
      throw new BusinessRuleError('CONTRACT_FILE_FORMAT_INVALID', 'Initial contract upload must be a DOCX file')
    }
  }

  private buildInitialUploadPlan(params: {
    tenantId: string
    contractId: string
    fileName: string
    fileSizeBytes: number
    fileMimeType: string
    counterparties?: Array<{
      counterpartyName: string
      supportingFiles: ContractFileMetadata[]
    }>
    supportingFiles?: ContractFileMetadata[]
  }): {
    primaryUpload: ContractFileMetadata & { path: string }
    counterpartySupportingUploads: Array<
      ContractFileMetadata & { path: string; counterpartyIndex: number; supportingIndex: number }
    >
    commonSupportingUploads: Array<ContractFileMetadata & { path: string; supportingIndex: number }>
  } {
    const safePrimaryFileName = this.sanitizeFileName(params.fileName)
    const primaryUpload = {
      fileName: safePrimaryFileName,
      fileSizeBytes: params.fileSizeBytes,
      fileMimeType: params.fileMimeType,
      path: `${params.tenantId}/${params.contractId}/${safePrimaryFileName}`,
    }

    const counterpartySupportingUploads = (params.counterparties ?? []).flatMap((counterparty, counterpartyIndex) =>
      counterparty.supportingFiles.map((supportingFile, supportingIndex) => {
        const safeSupportingFileName = this.sanitizeFileName(supportingFile.fileName)
        return {
          fileName: safeSupportingFileName,
          fileSizeBytes: supportingFile.fileSizeBytes,
          fileMimeType: supportingFile.fileMimeType,
          counterpartyIndex,
          supportingIndex,
          path: `${params.tenantId}/${params.contractId}/counterparty/${String(counterpartyIndex + 1).padStart(3, '0')}/${String(supportingIndex + 1).padStart(3, '0')}-${safeSupportingFileName}`,
        }
      })
    )

    const commonSupportingUploads = (params.supportingFiles ?? []).map((supportingFile, supportingIndex) => {
      const safeSupportingFileName = this.sanitizeFileName(supportingFile.fileName)
      return {
        fileName: safeSupportingFileName,
        fileSizeBytes: supportingFile.fileSizeBytes,
        fileMimeType: supportingFile.fileMimeType,
        supportingIndex,
        path: `${params.tenantId}/${params.contractId}/supporting/common/${String(supportingIndex + 1).padStart(3, '0')}-${safeSupportingFileName}`,
      }
    })

    return {
      primaryUpload,
      counterpartySupportingUploads,
      commonSupportingUploads,
    }
  }

  private async assertUploadsExist(paths: string[]): Promise<void> {
    const checks = await Promise.all(paths.map((path) => this.contractStorageRepository.exists(path)))
    if (checks.every(Boolean)) {
      return
    }

    throw new BusinessRuleError('CONTRACT_UPLOAD_INCOMPLETE', 'One or more uploaded files were not found in storage')
  }

  private async persistInitialUploadMetadata(params: {
    tenantId: string
    contractId: string
    title: string
    contractTypeId: string
    signatoryName: string
    signatoryDesignation: string
    signatoryEmail: string
    backgroundOfRequest: string
    departmentId: string
    budgetApproved: boolean
    uploadedByEmployeeId: string
    uploadedByEmail: string
    uploadedByRole: string
    uploadMode: UploadContractInput['uploadMode']
    bypassHodApproval?: boolean
    bypassReason?: string
    fileName: string
    filePath: string
    fileSizeBytes: number
    fileMimeType: string
    normalizedCounterparties: ReturnType<ContractUploadService['normalizeCounterpartiesMetadataInput']>
    uploadedSupportingFiles: Array<{
      filePath: string
      fileName: string
      fileSizeBytes: number
      fileMimeType: string
      counterpartySequenceOrder: number | null
      counterpartyName: string | null
    }>
  }): Promise<ContractRecord> {
    let contract: ContractRecord
    try {
      contract = await this.contractRepository.createWithAudit({
        contractId: params.contractId,
        tenantId: params.tenantId,
        title: params.title.trim(),
        contractTypeId: params.contractTypeId,
        signatoryName: params.signatoryName.trim(),
        signatoryDesignation: params.signatoryDesignation.trim(),
        signatoryEmail: params.signatoryEmail.trim().toLowerCase(),
        backgroundOfRequest: params.backgroundOfRequest.trim(),
        departmentId: params.departmentId,
        budgetApproved: params.budgetApproved,
        uploadedByEmployeeId: params.uploadedByEmployeeId,
        uploadedByEmail: params.uploadedByEmail,
        uploadedByRole: params.uploadedByRole,
        uploadMode: params.uploadMode,
        bypassHodApproval: Boolean(params.bypassHodApproval),
        bypassReason: params.bypassReason?.trim() || undefined,
        filePath: params.filePath,
        fileName: params.fileName,
        fileSizeBytes: params.fileSizeBytes,
        fileMimeType: params.fileMimeType,
      })
    } catch (error) {
      throw new DatabaseError('Failed to initialize contract after upload', error as Error, {
        tenantId: params.tenantId,
        contractId: params.contractId,
      })
    }

    try {
      const createdCounterparties = await this.contractRepository.createCounterparties(
        params.normalizedCounterparties.map((counterparty, index) => ({
          tenantId: params.tenantId,
          contractId: params.contractId,
          counterpartyName: counterparty.counterpartyName,
          sequenceOrder: index + 1,
        }))
      )

      const counterpartyIdBySequenceOrder = new Map<number, string>()
      for (const counterparty of createdCounterparties) {
        counterpartyIdBySequenceOrder.set(counterparty.sequenceOrder, counterparty.id)
      }

      const trimmedCounterpartyName = params.normalizedCounterparties[0]?.counterpartyName ?? ''
      if (trimmedCounterpartyName) {
        await this.contractRepository.setCounterpartyName({
          tenantId: params.tenantId,
          contractId: params.contractId,
          counterpartyName: trimmedCounterpartyName,
        })
      }

      await this.contractRepository.createDocument({
        tenantId: params.tenantId,
        contractId: params.contractId,
        documentKind: 'PRIMARY',
        versionNumber: contractDocumentVersioning.initialVersion,
        displayName: 'Primary Contract',
        fileName: params.fileName,
        filePath: params.filePath,
        fileSizeBytes: params.fileSizeBytes,
        fileMimeType: params.fileMimeType,
        uploadedByEmployeeId: params.uploadedByEmployeeId,
        uploadedByEmail: params.uploadedByEmail,
        uploadedByRole: params.uploadedByRole,
      })

      for (const [index, supportingFile] of params.uploadedSupportingFiles.entries()) {
        const displayNameBase = supportingFile.counterpartyName
          ? `Counterparty Docs - ${supportingFile.counterpartyName}`
          : params.budgetApproved
            ? 'Budget Approval Supporting Docs'
            : 'Additional Supporting Docs'

        await this.contractRepository.createDocument({
          tenantId: params.tenantId,
          contractId: params.contractId,
          documentKind: 'COUNTERPARTY_SUPPORTING',
          counterpartyId:
            supportingFile.counterpartySequenceOrder === null
              ? undefined
              : counterpartyIdBySequenceOrder.get(supportingFile.counterpartySequenceOrder),
          displayName: `${displayNameBase} (${index + 1})`,
          fileName: supportingFile.fileName,
          filePath: supportingFile.filePath,
          fileSizeBytes: supportingFile.fileSizeBytes,
          fileMimeType: supportingFile.fileMimeType,
          uploadedByEmployeeId: params.uploadedByEmployeeId,
          uploadedByEmail: params.uploadedByEmail,
        })
      }

      await this.contractRepository.upsertMasterCounterpartyNames({
        tenantId: params.tenantId,
        names: params.normalizedCounterparties
          .map((counterparty) => counterparty.counterpartyName)
          .filter((name) => name.toUpperCase() !== contractCounterpartyValues.notApplicable),
      })

      const draftRecipients = params.normalizedCounterparties
        .filter(
          (counterparty) => counterparty.counterpartyName.toUpperCase() !== contractCounterpartyValues.notApplicable
        )
        .flatMap((counterparty, counterpartyIndex) =>
          counterparty.signatories.map((signatory) => ({
            name: signatory.name,
            email: signatory.email,
            designation: signatory.designation,
            counterpartyId: counterpartyIdBySequenceOrder.get(counterpartyIndex + 1),
            counterpartyName: counterparty.counterpartyName,
            backgroundOfRequest: counterparty.backgroundOfRequest,
            budgetApproved: counterparty.budgetApproved,
            recipientType: 'EXTERNAL' as const,
          }))
        )
      const draftRecipientsByEmail = new Map<
        string,
        {
          name: string
          email: string
          designation?: string
          counterpartyId?: string
          counterpartyName?: string
          backgroundOfRequest?: string
          budgetApproved?: boolean
          recipientType: 'INTERNAL' | 'EXTERNAL'
        }
      >()
      for (const recipient of draftRecipients) {
        if (!recipient.email) {
          continue
        }
        if (!draftRecipientsByEmail.has(recipient.email)) {
          draftRecipientsByEmail.set(recipient.email, recipient)
        }
      }

      const seededDraftRecipients = Array.from(draftRecipientsByEmail.values()).map((recipient) => ({
        ...recipient,
        routingOrder: 1,
      }))

      if (seededDraftRecipients.length > 0) {
        try {
          if (typeof this.contractRepository.seedSigningPreparationDraft === 'function') {
            await this.contractRepository.seedSigningPreparationDraft({
              tenantId: params.tenantId,
              contractId: params.contractId,
              actorEmployeeId: params.uploadedByEmployeeId,
              recipients: seededDraftRecipients,
            })
          }
        } catch (error) {
          this.logger.warn('Signing preparation draft seed failed during upload', {
            tenantId: params.tenantId,
            contractId: params.contractId,
            recipientCount: seededDraftRecipients.length,
            error: String(error),
          })
        }
      }
    } catch (error) {
      this.logger.error('Contract document metadata persistence failed', {
        tenantId: params.tenantId,
        contractId: params.contractId,
        error: String(error),
      })

      throw new DatabaseError('Failed to persist contract metadata', error as Error, {
        tenantId: params.tenantId,
        contractId: params.contractId,
      })
    }

    return contract
  }

  private assertMainReplacementPermissions(contract: ContractAccessRecord, input: { uploadedByRole: string }): void {
    if (contract.status === contractStatuses.underReview) {
      return
    }

    const isLegalOrAdminStatus = this.legalReplacementStatuses.has(contract.status)
    const isAdminOnlyStatus = this.adminOnlyReplacementStatuses.has(contract.status)
    const isLegalActor = input.uploadedByRole === 'LEGAL_TEAM'
    const isAdminActor = input.uploadedByRole === 'ADMIN'

    if (isAdminOnlyStatus && !isAdminActor) {
      throw new AuthorizationError(
        'CONTRACT_REPLACEMENT_FORBIDDEN',
        'Only ADMIN can replace documents for rejected or void contracts'
      )
    }

    if (isLegalOrAdminStatus && !isLegalActor && !isAdminActor) {
      throw new AuthorizationError(
        'CONTRACT_REPLACEMENT_FORBIDDEN',
        'Only LEGAL_TEAM or ADMIN can replace documents in this contract status'
      )
    }

    if (!isLegalOrAdminStatus && !isAdminOnlyStatus) {
      throw new BusinessRuleError(
        'CONTRACT_REPLACEMENT_STATUS_FORBIDDEN',
        'Main document replacement is unavailable for the current contract status'
      )
    }
  }

  private async persistPrimaryReplacementMetadata(
    contract: ContractAccessRecord,
    input: ReplacePrimaryDocumentMetadataInput & { path: string }
  ): Promise<ContractDocumentRecord> {
    try {
      const replaceDocumentPromise = this.contractRepository.replacePrimaryDocument({
        tenantId: input.tenantId,
        contractId: input.contractId,
        fileName: input.fileName,
        filePath: input.path,
        fileSizeBytes: input.fileSizeBytes,
        fileMimeType: input.fileMimeType,
        uploadedByEmployeeId: input.uploadedByEmployeeId,
        uploadedByEmail: input.uploadedByEmail,
        uploadedByRole: input.uploadedByRole,
      })

      const targetStatus = this.resolveReplacementTargetStatus({
        currentStatus: contract.status,
        uploadedByRole: input.uploadedByRole,
        isFinalExecuted: input.isFinalExecuted,
      })
      const updateStatusPromise =
        targetStatus !== contract.status
          ? this.contractRepository.updateContractStatus({
              tenantId: input.tenantId,
              contractId: input.contractId,
              status: targetStatus,
            })
          : Promise.resolve()

      const [document] = await Promise.all([replaceDocumentPromise, updateStatusPromise])
      return document
    } catch (error) {
      throw new DatabaseError('Failed to replace main contract document', error as Error, {
        tenantId: input.tenantId,
        contractId: input.contractId,
      })
    }
  }

  private assertSupportingReplacementPermissions(
    contract: ContractAccessRecord,
    input: { uploadedByRole: string }
  ): void {
    if (contract.status === contractStatuses.underReview) {
      return
    }

    const isLegalOrAdminStatus = this.legalReplacementStatuses.has(contract.status)
    const isAdminOnlyStatus = this.adminOnlyReplacementStatuses.has(contract.status)
    const isLegalActor = input.uploadedByRole === 'LEGAL_TEAM'
    const isAdminActor = input.uploadedByRole === 'ADMIN'

    if (isAdminOnlyStatus && !isAdminActor) {
      throw new AuthorizationError(
        'CONTRACT_REPLACEMENT_FORBIDDEN',
        'Only ADMIN can replace documents for rejected or void contracts'
      )
    }

    if (isLegalOrAdminStatus && !isLegalActor && !isAdminActor) {
      throw new AuthorizationError(
        'CONTRACT_REPLACEMENT_FORBIDDEN',
        'Only LEGAL_TEAM or ADMIN can replace documents in this contract status'
      )
    }

    if (!isLegalOrAdminStatus && !isAdminOnlyStatus) {
      throw new BusinessRuleError(
        'CONTRACT_REPLACEMENT_STATUS_FORBIDDEN',
        'Supporting document replacement is unavailable for the current contract status'
      )
    }
  }

  private async persistSupportingReplacementMetadata(
    contract: ContractAccessRecord,
    sourceDocument: ContractDocumentAccessRecord,
    input: ReplaceSupportingDocumentMetadataInput & { path: string }
  ): Promise<void> {
    try {
      const replaceDocumentPromise = this.contractRepository.replaceSupportingDocument({
        tenantId: input.tenantId,
        contractId: input.contractId,
        sourceDocumentId: input.sourceDocumentId,
        counterpartyId: sourceDocument.counterpartyId ?? null,
        displayName: sourceDocument.displayName ?? 'Counterparty Supporting Document',
        fileName: input.fileName,
        filePath: input.path,
        fileSizeBytes: input.fileSizeBytes,
        fileMimeType: input.fileMimeType,
        uploadedByEmployeeId: input.uploadedByEmployeeId,
        uploadedByEmail: input.uploadedByEmail,
        uploadedByRole: input.uploadedByRole,
      })
      const updateStatusPromise =
        contract.status !== contractStatuses.underReview
          ? this.contractRepository.updateContractStatus({
              tenantId: input.tenantId,
              contractId: input.contractId,
              status: contractStatuses.underReview,
            })
          : Promise.resolve()
      await Promise.all([replaceDocumentPromise, updateStatusPromise])
    } catch (error) {
      throw new DatabaseError('Failed to replace supporting contract document', error as Error, {
        tenantId: input.tenantId,
        contractId: input.contractId,
        sourceDocumentId: input.sourceDocumentId,
      })
    }
  }

  private isDocxUpload(fileName: string, mimeType: string): boolean {
    const normalizedMimeType = mimeType.trim().toLowerCase()
    const normalizedFileName = fileName.trim().toLowerCase()

    return (
      normalizedMimeType === contractDocumentMimeTypes.docx ||
      normalizedFileName.endsWith('.docx') ||
      (normalizedMimeType === 'application/octet-stream' && normalizedFileName.endsWith('.docx'))
    )
  }

  private isAllowedReplacementUpload(fileName: string, mimeType: string): boolean {
    const normalizedMimeType = mimeType.trim().toLowerCase()
    const normalizedFileName = fileName.trim().toLowerCase()

    if (normalizedMimeType === contractDocumentMimeTypes.docx || normalizedFileName.endsWith('.docx')) {
      return true
    }

    if (normalizedMimeType === contractDocumentMimeTypes.pdf || normalizedFileName.endsWith('.pdf')) {
      return true
    }

    return false
  }

  private isPdfUpload(fileName: string, mimeType: string): boolean {
    const normalizedMimeType = mimeType.trim().toLowerCase()
    const normalizedFileName = fileName.trim().toLowerCase()

    return (
      normalizedMimeType === contractDocumentMimeTypes.pdf ||
      normalizedFileName.endsWith('.pdf') ||
      (normalizedMimeType === 'application/octet-stream' && normalizedFileName.endsWith('.pdf'))
    )
  }

  private validateUploadInput(input: UploadContractInput): void {
    if (!input.title.trim()) {
      throw new BusinessRuleError('CONTRACT_TITLE_REQUIRED', 'Contract title is required')
    }

    if (!input.fileName.trim()) {
      throw new BusinessRuleError('CONTRACT_FILE_REQUIRED', 'A contract file is required')
    }

    if (input.fileSizeBytes <= 0) {
      throw new BusinessRuleError('CONTRACT_FILE_EMPTY', 'Uploaded contract file is empty')
    }

    const maxFileSizeBytes = limits.maxUploadSizeMb * 1024 * 1024
    if (input.fileSizeBytes > maxFileSizeBytes) {
      throw new BusinessRuleError('CONTRACT_FILE_TOO_LARGE', `Uploaded file exceeds ${limits.maxUploadSizeMb}MB limit`)
    }

    if (!input.fileMimeType.trim()) {
      throw new BusinessRuleError('CONTRACT_FILE_MIME_REQUIRED', 'File MIME type is required')
    }

    if (!input.signatoryName.trim()) {
      throw new BusinessRuleError('SIGNATORY_NAME_REQUIRED', 'Signatory name is required')
    }

    if (!input.signatoryDesignation.trim()) {
      throw new BusinessRuleError('SIGNATORY_DESIGNATION_REQUIRED', 'Signatory designation is required')
    }

    if (!input.signatoryEmail.trim()) {
      throw new BusinessRuleError('SIGNATORY_EMAIL_REQUIRED', 'Signatory email is required')
    }

    if (!this.isValidSignatoryEmail(input.signatoryEmail)) {
      throw new BusinessRuleError('SIGNATORY_EMAIL_INVALID', 'Signatory email format is invalid')
    }

    if (!input.backgroundOfRequest.trim()) {
      throw new BusinessRuleError('BACKGROUND_OF_REQUEST_REQUIRED', 'Background of request is required')
    }

    const totalSupportingFileCount =
      (input.supportingFiles?.length ?? 0) +
      (input.counterparties?.reduce((count, counterparty) => count + counterparty.supportingFiles.length, 0) ?? 0)
    if (input.budgetApproved && totalSupportingFileCount === 0) {
      throw new BusinessRuleError(
        'BUDGET_APPROVAL_SUPPORTING_REQUIRED',
        'Supporting document is required when budget approved is set to yes'
      )
    }

    if (!input.departmentId.trim()) {
      throw new BusinessRuleError('DEPARTMENT_ID_REQUIRED', 'Department is required')
    }

    if (!input.contractTypeId.trim()) {
      throw new BusinessRuleError('CONTRACT_TYPE_ID_REQUIRED', 'Contract type is required')
    }

    const normalizedCounterparties = this.normalizeCounterparties(input)
    if (normalizedCounterparties.length === 0) {
      throw new BusinessRuleError('COUNTERPARTY_REQUIRED', 'At least one counterparty is required')
    }

    for (const counterparty of normalizedCounterparties) {
      const isNotApplicableCounterparty =
        counterparty.counterpartyName.toUpperCase() === contractCounterpartyValues.notApplicable

      if (counterparty.counterpartyName.length > 200) {
        throw new BusinessRuleError('COUNTERPARTY_NAME_TOO_LONG', 'Counterparty name exceeds maximum length')
      }

      if (!isNotApplicableCounterparty && counterparty.signatories.length === 0) {
        throw new BusinessRuleError(
          'SIGNATORY_NAME_REQUIRED',
          `At least one signatory is required for counterparty ${counterparty.counterpartyName}`
        )
      }

      if (isNotApplicableCounterparty && counterparty.signatories.length > 0) {
        throw new BusinessRuleError(
          'SIGNATORY_NAME_REQUIRED',
          `Signatories are not allowed for counterparty ${counterparty.counterpartyName}`
        )
      }

      const seenSignatoryEmails = new Set<string>()
      for (const signatory of counterparty.signatories) {
        if (!isNotApplicableCounterparty && !signatory.name.trim()) {
          throw new BusinessRuleError(
            'SIGNATORY_NAME_REQUIRED',
            `Signatory name is required for counterparty ${counterparty.counterpartyName}`
          )
        }

        if (!isNotApplicableCounterparty && !signatory.designation.trim()) {
          throw new BusinessRuleError(
            'SIGNATORY_DESIGNATION_REQUIRED',
            `Signatory designation is required for counterparty ${counterparty.counterpartyName}`
          )
        }

        if (!isNotApplicableCounterparty && !signatory.email.trim()) {
          throw new BusinessRuleError(
            'SIGNATORY_EMAIL_REQUIRED',
            `Signatory email is required for counterparty ${counterparty.counterpartyName}`
          )
        }

        if (!isNotApplicableCounterparty && !this.isValidSignatoryEmail(signatory.email)) {
          throw new BusinessRuleError(
            'SIGNATORY_EMAIL_INVALID',
            `Signatory email format is invalid for counterparty ${counterparty.counterpartyName}`
          )
        }

        const normalizedEmail = signatory.email.trim().toLowerCase()
        if (normalizedEmail) {
          if (seenSignatoryEmails.has(normalizedEmail)) {
            throw new BusinessRuleError(
              'SIGNATORY_EMAIL_INVALID',
              `Duplicate signatory emails are not allowed for counterparty ${counterparty.counterpartyName}`
            )
          }
          seenSignatoryEmails.add(normalizedEmail)
        }
      }

      const requiresSupportingDocs =
        !isNotApplicableCounterparty &&
        counterparty.counterpartyName.toUpperCase() !== contractCounterpartyValues.notApplicable
      if (requiresSupportingDocs && counterparty.supportingFiles.length === 0) {
        throw new BusinessRuleError(
          'COUNTERPARTY_SUPPORTING_REQUIRED',
          `Supporting documents are required for counterparty ${counterparty.counterpartyName}`
        )
      }

      for (const supportingFile of counterparty.supportingFiles) {
        if (!supportingFile.fileName.trim()) {
          throw new BusinessRuleError('SUPPORTING_FILE_NAME_REQUIRED', 'Supporting document name is required')
        }

        if (supportingFile.fileSizeBytes <= 0) {
          throw new BusinessRuleError('SUPPORTING_FILE_EMPTY', 'Supporting document cannot be empty')
        }

        if (supportingFile.fileSizeBytes > maxFileSizeBytes) {
          throw new BusinessRuleError(
            'SUPPORTING_FILE_TOO_LARGE',
            `Supporting file exceeds ${limits.maxUploadSizeMb}MB limit`
          )
        }

        if (!supportingFile.fileMimeType.trim()) {
          throw new BusinessRuleError('SUPPORTING_FILE_MIME_REQUIRED', 'Supporting document MIME type is required')
        }
      }
    }
  }

  private normalizeCounterparties(input: UploadContractInput): Array<{
    counterpartyName: string
    backgroundOfRequest: string
    budgetApproved: boolean
    signatories: Array<{
      name: string
      designation: string
      email: string
    }>
    supportingFiles: Array<{
      fileName: string
      fileSizeBytes: number
      fileMimeType: string
      fileBody: Blob
    }>
  }> {
    if (input.counterparties && input.counterparties.length > 0) {
      return input.counterparties
        .map((entry) => {
          const normalizedCounterpartyName = entry.counterpartyName.trim()
          const isNotApplicableCounterparty =
            normalizedCounterpartyName.toUpperCase() === contractCounterpartyValues.notApplicable

          return {
            counterpartyName: normalizedCounterpartyName,
            backgroundOfRequest: isNotApplicableCounterparty
              ? contractCounterpartyValues.notApplicable
              : (entry.backgroundOfRequest?.trim() ?? ''),
            budgetApproved: isNotApplicableCounterparty ? false : Boolean(entry.budgetApproved),
            signatories: isNotApplicableCounterparty
              ? []
              : (entry.signatories ?? []).map((signatory) => ({
                  name: signatory.name.trim(),
                  designation: signatory.designation.trim(),
                  email: signatory.email.trim().toLowerCase(),
                })),
            supportingFiles: isNotApplicableCounterparty ? [] : entry.supportingFiles,
          }
        })
        .filter((entry) => entry.counterpartyName.length > 0)
    }

    const counterpartyName = input.counterpartyName?.trim() ?? ''
    if (!counterpartyName) {
      return []
    }
    const isNotApplicableCounterparty = counterpartyName.toUpperCase() === contractCounterpartyValues.notApplicable

    return [
      {
        counterpartyName,
        backgroundOfRequest: isNotApplicableCounterparty
          ? contractCounterpartyValues.notApplicable
          : input.backgroundOfRequest.trim(),
        budgetApproved: isNotApplicableCounterparty ? false : input.budgetApproved,
        signatories: isNotApplicableCounterparty
          ? []
          : [
              {
                name: input.signatoryName.trim(),
                designation: input.signatoryDesignation.trim(),
                email: input.signatoryEmail.trim().toLowerCase(),
              },
            ],
        supportingFiles: isNotApplicableCounterparty ? [] : (input.supportingFiles ?? []),
      },
    ]
  }

  private normalizeCounterpartiesMetadataInput(input: UploadContractInput): Array<{
    counterpartyName: string
    backgroundOfRequest: string
    budgetApproved: boolean
    signatories: Array<{
      name: string
      designation: string
      email: string
    }>
    supportingFiles: Array<{
      fileName: string
      fileSizeBytes: number
      fileMimeType: string
    }>
  }> {
    if (input.counterparties && input.counterparties.length > 0) {
      return input.counterparties
        .map((entry) => {
          const normalizedCounterpartyName = entry.counterpartyName.trim()
          const isNotApplicableCounterparty =
            normalizedCounterpartyName.toUpperCase() === contractCounterpartyValues.notApplicable

          return {
            counterpartyName: normalizedCounterpartyName,
            backgroundOfRequest: isNotApplicableCounterparty
              ? contractCounterpartyValues.notApplicable
              : (entry.backgroundOfRequest?.trim() ?? ''),
            budgetApproved: isNotApplicableCounterparty ? false : Boolean(entry.budgetApproved),
            signatories: isNotApplicableCounterparty
              ? []
              : (entry.signatories ?? []).map((signatory) => ({
                  name: signatory.name.trim(),
                  designation: signatory.designation.trim(),
                  email: signatory.email.trim().toLowerCase(),
                })),
            supportingFiles: isNotApplicableCounterparty
              ? []
              : entry.supportingFiles.map((supportingFile) => ({
                  fileName: supportingFile.fileName,
                  fileSizeBytes: supportingFile.fileSizeBytes,
                  fileMimeType: supportingFile.fileMimeType,
                })),
          }
        })
        .filter((entry) => entry.counterpartyName.length > 0)
    }

    const counterpartyName = input.counterpartyName?.trim() ?? ''
    if (!counterpartyName) {
      return []
    }
    const isNotApplicableCounterparty = counterpartyName.toUpperCase() === contractCounterpartyValues.notApplicable

    return [
      {
        counterpartyName,
        backgroundOfRequest: isNotApplicableCounterparty
          ? contractCounterpartyValues.notApplicable
          : input.backgroundOfRequest.trim(),
        budgetApproved: isNotApplicableCounterparty ? false : input.budgetApproved,
        signatories: isNotApplicableCounterparty
          ? []
          : [
              {
                name: input.signatoryName.trim(),
                designation: input.signatoryDesignation.trim(),
                email: input.signatoryEmail.trim().toLowerCase(),
              },
            ],
        supportingFiles: isNotApplicableCounterparty
          ? []
          : (input.supportingFiles ?? []).map((supportingFile) => ({
              fileName: supportingFile.fileName,
              fileSizeBytes: supportingFile.fileSizeBytes,
              fileMimeType: supportingFile.fileMimeType,
            })),
      },
    ]
  }

  private sanitizeFileName(fileName: string): string {
    const normalized = fileName.replace(/\\/g, '/').split('/').pop() ?? 'contract-file'
    const safe = normalized.replace(/[^a-zA-Z0-9._-]/g, '_')
    return safe.slice(0, 180)
  }

  private isValidSignatoryEmail(value: string): boolean {
    const normalizedValue = value.trim()
    if (normalizedValue.toUpperCase() === 'NA') {
      return true
    }

    return this.emailPattern.test(normalizedValue)
  }

  private validateReplacementInput(
    input: Pick<ReplacePrimaryDocumentInput, 'contractId' | 'fileName' | 'fileSizeBytes' | 'fileMimeType'>
  ): void {
    if (!input.contractId.trim()) {
      throw new BusinessRuleError('CONTRACT_ID_REQUIRED', 'Contract ID is required')
    }

    if (!input.fileName.trim()) {
      throw new BusinessRuleError('CONTRACT_FILE_REQUIRED', 'A contract file is required')
    }

    if (input.fileSizeBytes <= 0) {
      throw new BusinessRuleError('CONTRACT_FILE_EMPTY', 'Uploaded contract file is empty')
    }

    const maxFileSizeBytes = limits.maxUploadSizeMb * 1024 * 1024
    if (input.fileSizeBytes > maxFileSizeBytes) {
      throw new BusinessRuleError('CONTRACT_FILE_TOO_LARGE', `Uploaded file exceeds ${limits.maxUploadSizeMb}MB limit`)
    }

    if (!input.fileMimeType.trim()) {
      throw new BusinessRuleError('CONTRACT_FILE_MIME_REQUIRED', 'File MIME type is required')
    }
  }

  private validateSupportingReplacementInput(
    input: Pick<
      ReplaceSupportingDocumentInput,
      'contractId' | 'sourceDocumentId' | 'fileName' | 'fileSizeBytes' | 'fileMimeType'
    >
  ): void {
    if (!input.contractId.trim()) {
      throw new BusinessRuleError('CONTRACT_ID_REQUIRED', 'Contract ID is required')
    }

    if (!input.sourceDocumentId.trim()) {
      throw new BusinessRuleError('DOCUMENT_ID_REQUIRED', 'Document ID is required')
    }

    if (!input.fileName.trim()) {
      throw new BusinessRuleError('CONTRACT_FILE_REQUIRED', 'A contract file is required')
    }

    if (input.fileSizeBytes <= 0) {
      throw new BusinessRuleError('CONTRACT_FILE_EMPTY', 'Uploaded contract file is empty')
    }

    const maxFileSizeBytes = limits.maxUploadSizeMb * 1024 * 1024
    if (input.fileSizeBytes > maxFileSizeBytes) {
      throw new BusinessRuleError('CONTRACT_FILE_TOO_LARGE', `Uploaded file exceeds ${limits.maxUploadSizeMb}MB limit`)
    }

    if (!input.fileMimeType.trim()) {
      throw new BusinessRuleError('CONTRACT_FILE_MIME_REQUIRED', 'File MIME type is required')
    }
  }

  private resolveReplacementTargetStatus(params: {
    currentStatus: ContractStatus
    uploadedByRole: string
    isFinalExecuted?: boolean
  }): ContractStatus {
    const shouldRemainOrRouteToHodPendingForPoc =
      params.uploadedByRole === 'POC' &&
      (params.currentStatus === contractStatuses.hodPending || params.currentStatus === contractStatuses.rejected)

    if (params.isFinalExecuted) {
      return contractStatuses.executed
    }

    if (shouldRemainOrRouteToHodPendingForPoc) {
      return contractStatuses.hodPending
    }

    return contractStatuses.underReview
  }
}
