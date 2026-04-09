import { ContractUploadService } from '@/core/domain/contracts/contract-upload-service'
import { AuthorizationError, BusinessRuleError } from '@/core/http/errors'
import { contractStatuses, contractUploadModes } from '@/core/constants/contracts'

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}

describe('ContractUploadService signing source regression', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses contract.currentDocumentId as default signing source', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue({
        id: 'contract-1',
        tenantId: 'tenant-1',
        uploadedByEmployeeId: 'uploader-1',
        currentAssigneeEmployeeId: 'legal-1',
        status: 'FINAL_APPROVED',
        currentDocumentId: 'doc-active-2',
        filePath: 'legacy/path.docx',
        fileName: 'legacy.docx',
      }),
      getDocumentForAccess: jest.fn().mockResolvedValue({
        id: 'doc-active-2',
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        versionNumber: 2,
        filePath: 'tenant-1/contract-1/versions/v2.docx',
        fileName: 'v2.docx',
      }),
      isUploaderInActorTeam: jest.fn().mockResolvedValue(false),
    }

    const contractStorageRepository = {
      createSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/v2'),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    const result = await service.createSignedDownloadUrl({
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      requestorEmployeeId: 'legal-1',
      requestorRole: 'LEGAL_TEAM',
    })

    expect(contractRepository.getDocumentForAccess).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      documentId: 'doc-active-2',
    })
    expect(contractStorageRepository.createSignedDownloadUrl).toHaveBeenCalledWith(
      'tenant-1/contract-1/versions/v2.docx',
      expect.any(Number)
    )
    expect(result).toEqual({
      signedUrl: 'https://signed.example/v2',
      fileName: 'v2.docx',
    })
  })

  it('throws when current_document_id is missing and no explicit document id is provided', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue({
        id: 'contract-1',
        tenantId: 'tenant-1',
        uploadedByEmployeeId: 'uploader-1',
        currentAssigneeEmployeeId: 'legal-1',
        status: 'FINAL_APPROVED',
        currentDocumentId: null,
        filePath: 'legacy/path.docx',
        fileName: 'legacy.docx',
      }),
      isUploaderInActorTeam: jest.fn().mockResolvedValue(false),
      getDocumentForAccess: jest.fn(),
    }

    const contractStorageRepository = {
      createSignedDownloadUrl: jest.fn(),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.createSignedDownloadUrl({
        contractId: 'contract-1',
        tenantId: 'tenant-1',
        requestorEmployeeId: 'legal-1',
        requestorRole: 'LEGAL_TEAM',
      })
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'CONTRACT_CURRENT_DOCUMENT_MISSING',
    })

    expect(contractRepository.getDocumentForAccess).not.toHaveBeenCalled()
    expect(contractStorageRepository.createSignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('still serves explicit documentId requests for authorized readers', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue({
        id: 'contract-1',
        tenantId: 'tenant-1',
        uploadedByEmployeeId: 'uploader-1',
        currentAssigneeEmployeeId: 'legal-1',
        status: 'FINAL_APPROVED',
        currentDocumentId: null,
        filePath: 'legacy/path.docx',
        fileName: 'legacy.docx',
      }),
      getDocumentForAccess: jest.fn().mockResolvedValue({
        id: 'doc-explicit-1',
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        versionNumber: 1,
        filePath: 'tenant-1/contract-1/explicit.pdf',
        fileName: 'explicit.pdf',
      }),
      isUploaderInActorTeam: jest.fn().mockResolvedValue(false),
    }

    const contractStorageRepository = {
      createSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/explicit'),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    const result = await service.createSignedDownloadUrl({
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      requestorEmployeeId: 'legal-1',
      requestorRole: 'LEGAL_TEAM',
      documentId: 'doc-explicit-1',
    })

    expect(contractRepository.getDocumentForAccess).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      documentId: 'doc-explicit-1',
    })
    expect(result.fileName).toBe('explicit.pdf')
  })

  it('blocks unauthorized readers', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue({
        id: 'contract-1',
        tenantId: 'tenant-1',
        uploadedByEmployeeId: 'uploader-1',
        currentAssigneeEmployeeId: 'legal-1',
        status: 'FINAL_APPROVED',
        currentDocumentId: 'doc-active-2',
        filePath: 'legacy/path.docx',
        fileName: 'legacy.docx',
      }),
      getDocumentForAccess: jest.fn(),
      isUploaderInActorTeam: jest.fn().mockResolvedValue(false),
    }

    const service = new ContractUploadService(contractRepository as never, {} as never, logger)

    await expect(
      service.createSignedDownloadUrl({
        contractId: 'contract-1',
        tenantId: 'tenant-1',
        requestorEmployeeId: 'random-user',
        requestorRole: 'POC',
      })
    ).rejects.toMatchObject<Partial<AuthorizationError>>({
      code: 'CONTRACT_READ_FORBIDDEN',
    })
  })

  it('blocks upload when POC is not assigned to selected department', async () => {
    const contractRepository = {
      isPocAssignedToDepartment: jest.fn().mockResolvedValue(false),
      createWithAudit: jest.fn(),
      createCounterparties: jest.fn(),
      setCounterpartyName: jest.fn(),
      createDocument: jest.fn(),
    }

    const contractStorageRepository = {
      upload: jest.fn(),
      remove: jest.fn(),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.uploadContract({
        tenantId: 'tenant-1',
        uploadedByEmployeeId: 'poc-1',
        uploadedByEmail: 'poc@nxtwave.co.in',
        uploadedByRole: 'POC',
        uploadMode: contractUploadModes.default,
        title: 'MSA',
        contractTypeId: 'type-1',
        signatoryName: 'Signer',
        signatoryDesignation: 'Manager',
        signatoryEmail: 'signer@example.com',
        backgroundOfRequest: 'Need legal review',
        departmentId: 'dept-unassigned',
        budgetApproved: false,
        counterpartyName: 'NA',
        fileName: 'contract.docx',
        fileSizeBytes: 1024,
        fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileBody: new Blob([new Uint8Array([1, 2, 3])]),
      })
    ).rejects.toMatchObject<Partial<AuthorizationError>>({
      code: 'CONTRACT_UPLOAD_DEPARTMENT_FORBIDDEN',
    })

    expect(contractRepository.isPocAssignedToDepartment).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      pocEmail: 'poc@nxtwave.co.in',
      departmentId: 'dept-unassigned',
    })
    expect(contractStorageRepository.upload).not.toHaveBeenCalled()
  })

  it('blocks upload when HOD is not assigned to selected department', async () => {
    const contractRepository = {
      isHodAssignedToDepartment: jest.fn().mockResolvedValue(false),
      createWithAudit: jest.fn(),
      createCounterparties: jest.fn(),
      setCounterpartyName: jest.fn(),
      createDocument: jest.fn(),
    }

    const contractStorageRepository = {
      upload: jest.fn(),
      remove: jest.fn(),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.uploadContract({
        tenantId: 'tenant-1',
        uploadedByEmployeeId: 'hod-1',
        uploadedByEmail: 'hod@nxtwave.co.in',
        uploadedByRole: 'HOD',
        title: 'MSA',
        contractTypeId: 'type-1',
        signatoryName: 'Signer',
        signatoryDesignation: 'Manager',
        signatoryEmail: 'signer@example.com',
        backgroundOfRequest: 'Need legal review',
        departmentId: 'dept-unassigned',
        budgetApproved: false,
        uploadMode: contractUploadModes.default,
        counterpartyName: 'NA',
        fileName: 'contract.docx',
        fileSizeBytes: 1024,
        fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileBody: new Blob([new Uint8Array([1, 2, 3])]),
      })
    ).rejects.toMatchObject<Partial<AuthorizationError>>({
      code: 'CONTRACT_UPLOAD_DEPARTMENT_FORBIDDEN',
    })

    expect(contractRepository.isHodAssignedToDepartment).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      hodEmail: 'hod@nxtwave.co.in',
      departmentId: 'dept-unassigned',
    })
    expect(contractStorageRepository.upload).not.toHaveBeenCalled()
  })

  it('allows upload when HOD is assigned to selected department', async () => {
    const contractRepository = {
      isHodAssignedToDepartment: jest.fn().mockResolvedValue(true),
      createWithAudit: jest.fn().mockResolvedValue({
        id: 'contract-1',
        tenantId: 'tenant-1',
        title: 'MSA',
        contractTypeId: 'type-1',
        signatoryName: 'Signer',
        signatoryDesignation: 'Manager',
        signatoryEmail: 'signer@example.com',
        backgroundOfRequest: 'Need legal review',
        departmentId: 'dept-1',
        budgetApproved: false,
        requestCreatedAt: new Date().toISOString(),
        uploadedByEmployeeId: 'hod-1',
        uploadedByEmail: 'hod@nxtwave.co.in',
        currentAssigneeEmployeeId: 'hod-1',
        currentAssigneeEmail: 'hod@nxtwave.co.in',
        status: 'HOD_PENDING',
        filePath: 'tenant-1/contract-1/contract.docx',
        fileName: 'contract.docx',
        fileSizeBytes: 1024,
        fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      createCounterparties: jest.fn().mockResolvedValue([
        {
          id: 'counterparty-1',
          tenantId: 'tenant-1',
          contractId: 'contract-1',
          counterpartyName: 'NA',
          sequenceOrder: 1,
        },
      ]),
      setCounterpartyName: jest.fn().mockResolvedValue(undefined),
      createDocument: jest.fn().mockResolvedValue(undefined),
      upsertMasterCounterpartyNames: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.uploadContract({
        tenantId: 'tenant-1',
        uploadedByEmployeeId: 'hod-1',
        uploadedByEmail: 'hod@nxtwave.co.in',
        uploadedByRole: 'HOD',
        title: 'MSA',
        contractTypeId: 'type-1',
        signatoryName: 'Signer',
        signatoryDesignation: 'Manager',
        signatoryEmail: 'signer@example.com',
        backgroundOfRequest: 'Need legal review',
        departmentId: 'dept-1',
        budgetApproved: false,
        uploadMode: contractUploadModes.default,
        counterpartyName: 'NA',
        fileName: 'contract.docx',
        fileSizeBytes: 1024,
        fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileBody: new Blob([new Uint8Array([1, 2, 3])]),
      })
    ).resolves.toBeDefined()

    expect(contractRepository.isHodAssignedToDepartment).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      hodEmail: 'hod@nxtwave.co.in',
      departmentId: 'dept-1',
    })
    expect(contractStorageRepository.upload).toHaveBeenCalled()
    expect(contractRepository.createWithAudit).toHaveBeenCalled()
  })

  it('allows NA signatory email in default upload mode', async () => {
    const contractRepository = {
      isHodAssignedToDepartment: jest.fn().mockResolvedValue(true),
      createWithAudit: jest.fn().mockResolvedValue({
        id: 'contract-1',
        tenantId: 'tenant-1',
        title: 'MSA',
        contractTypeId: 'type-1',
        signatoryName: 'Signer',
        signatoryDesignation: 'Manager',
        signatoryEmail: 'na',
        backgroundOfRequest: 'Need legal review',
        departmentId: 'dept-1',
        budgetApproved: false,
        requestCreatedAt: new Date().toISOString(),
        uploadedByEmployeeId: 'hod-1',
        uploadedByEmail: 'hod@nxtwave.co.in',
        currentAssigneeEmployeeId: 'hod-1',
        currentAssigneeEmail: 'hod@nxtwave.co.in',
        status: 'HOD_PENDING',
        filePath: 'tenant-1/contract-1/contract.docx',
        fileName: 'contract.docx',
        fileSizeBytes: 1024,
        fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      createCounterparties: jest.fn().mockResolvedValue([
        {
          id: 'counterparty-1',
          tenantId: 'tenant-1',
          contractId: 'contract-1',
          counterpartyName: 'NA',
          sequenceOrder: 1,
        },
      ]),
      setCounterpartyName: jest.fn().mockResolvedValue(undefined),
      createDocument: jest.fn().mockResolvedValue(undefined),
      upsertMasterCounterpartyNames: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.uploadContract({
        tenantId: 'tenant-1',
        uploadedByEmployeeId: 'hod-1',
        uploadedByEmail: 'hod@nxtwave.co.in',
        uploadedByRole: 'HOD',
        title: 'MSA',
        contractTypeId: 'type-1',
        signatoryName: 'Signer',
        signatoryDesignation: 'Manager',
        signatoryEmail: 'NA',
        backgroundOfRequest: 'Need legal review',
        departmentId: 'dept-1',
        budgetApproved: false,
        uploadMode: contractUploadModes.default,
        counterpartyName: 'NA',
        fileName: 'contract.docx',
        fileSizeBytes: 1024,
        fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileBody: new Blob([new Uint8Array([1, 2, 3])]),
      })
    ).resolves.toBeDefined()

    expect(contractRepository.createWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        signatoryEmail: 'na',
      })
    )
  })
})

describe('ContractUploadService legal send-for-signing validations', () => {
  const buildUploadInput = (overrides?: Record<string, unknown>) => ({
    tenantId: 'tenant-1',
    uploadedByEmployeeId: 'employee-1',
    uploadedByEmail: 'legal@nxtwave.co.in',
    uploadedByRole: 'LEGAL_TEAM',
    uploadMode: contractUploadModes.legalSendForSigning,
    bypassHodApproval: false,
    bypassReason: undefined,
    title: 'NDA',
    contractTypeId: 'contract-type-1',
    signatoryName: 'Vendor Signatory',
    signatoryDesignation: 'Director',
    signatoryEmail: 'vendor@example.com',
    backgroundOfRequest: 'Need contract execution',
    departmentId: 'department-1',
    budgetApproved: false,
    counterpartyName: 'NA',
    fileName: 'agreement.pdf',
    fileSizeBytes: 1024,
    fileMimeType: 'application/pdf',
    fileBody: new Blob([new Uint8Array([1, 2, 3])]),
    supportingFiles: [],
    ...overrides,
  })

  it('rejects legal send-for-signing uploads when file is not PDF', async () => {
    const contractRepository = {
      createWithAudit: jest.fn(),
    }

    const contractStorageRepository = {
      upload: jest.fn(),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.uploadContract(
        buildUploadInput({
          fileName: 'agreement.docx',
          fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }) as never
      )
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'CONTRACT_FILE_FORMAT_INVALID',
    })

    expect(contractStorageRepository.upload).not.toHaveBeenCalled()
    expect(contractRepository.createWithAudit).not.toHaveBeenCalled()
  })

  it('requires bypass reason when bypass HOD approval is enabled', async () => {
    const contractRepository = {
      createWithAudit: jest.fn(),
    }

    const contractStorageRepository = {
      upload: jest.fn(),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.uploadContract(
        buildUploadInput({
          bypassHodApproval: true,
          bypassReason: '   ',
        }) as never
      )
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'BYPASS_REASON_REQUIRED',
    })

    expect(contractStorageRepository.upload).not.toHaveBeenCalled()
    expect(contractRepository.createWithAudit).not.toHaveBeenCalled()
  })

  it('passes bypass metadata into repository in legal send-for-signing mode', async () => {
    const contractRepository = {
      createWithAudit: jest.fn().mockResolvedValue({
        id: 'contract-1',
        tenantId: 'tenant-1',
        title: 'NDA',
        contractTypeId: 'contract-type-1',
        signatoryName: 'Vendor Signatory',
        signatoryDesignation: 'Director',
        signatoryEmail: 'vendor@example.com',
        backgroundOfRequest: 'Need contract execution',
        departmentId: 'department-1',
        budgetApproved: true,
        requestCreatedAt: new Date().toISOString(),
        uploadedByEmployeeId: 'employee-1',
        uploadedByEmail: 'legal@nxtwave.co.in',
        currentAssigneeEmployeeId: 'employee-1',
        currentAssigneeEmail: 'legal@nxtwave.co.in',
        status: 'COMPLETED',
        filePath: 'tenant-1/contract-1/agreement.pdf',
        fileName: 'agreement.pdf',
        fileSizeBytes: 1024,
        fileMimeType: 'application/pdf',
      }),
      createCounterparties: jest.fn().mockResolvedValue([
        {
          id: 'counterparty-1',
          tenantId: 'tenant-1',
          contractId: 'contract-1',
          counterpartyName: 'NA',
          sequenceOrder: 1,
        },
      ]),
      setCounterpartyName: jest.fn().mockResolvedValue(undefined),
      createDocument: jest.fn().mockResolvedValue(undefined),
      upsertMasterCounterpartyNames: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await service.uploadContract(
      buildUploadInput({
        bypassHodApproval: true,
        bypassReason: 'Urgent legal override for immediate execution',
      }) as never
    )

    expect(contractRepository.createWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadMode: contractUploadModes.legalSendForSigning,
        bypassHodApproval: true,
        bypassReason: 'Urgent legal override for immediate execution',
      })
    )
  })

  it('requires designation, email, and background in legal send-for-signing mode', async () => {
    const contractRepository = {
      createWithAudit: jest.fn().mockResolvedValue({
        id: 'contract-1',
        tenantId: 'tenant-1',
        title: 'NDA',
        contractTypeId: 'contract-type-1',
        signatoryName: 'Vendor Signatory',
        signatoryDesignation: '',
        signatoryEmail: '',
        backgroundOfRequest: '',
        departmentId: 'department-1',
        budgetApproved: false,
        requestCreatedAt: new Date().toISOString(),
        uploadedByEmployeeId: 'employee-1',
        uploadedByEmail: 'legal@nxtwave.co.in',
        currentAssigneeEmployeeId: 'employee-1',
        currentAssigneeEmail: 'legal@nxtwave.co.in',
        status: 'COMPLETED',
        filePath: 'tenant-1/contract-1/agreement.pdf',
        fileName: 'agreement.pdf',
        fileSizeBytes: 1024,
        fileMimeType: 'application/pdf',
      }),
      createCounterparties: jest.fn().mockResolvedValue([
        {
          id: 'counterparty-1',
          tenantId: 'tenant-1',
          contractId: 'contract-1',
          counterpartyName: 'NA',
          sequenceOrder: 1,
        },
      ]),
      setCounterpartyName: jest.fn().mockResolvedValue(undefined),
      createDocument: jest.fn().mockResolvedValue(undefined),
      upsertMasterCounterpartyNames: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.uploadContract(
        buildUploadInput({
          signatoryDesignation: '   ',
          signatoryEmail: '   ',
          backgroundOfRequest: '   ',
          budgetApproved: false,
        }) as never
      )
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'SIGNATORY_DESIGNATION_REQUIRED',
    })

    expect(contractRepository.createWithAudit).not.toHaveBeenCalled()
  })

  it('requires supporting documents for non-NA counterparty in send-for-signing mode', async () => {
    const contractRepository = {
      createWithAudit: jest.fn().mockResolvedValue({
        id: 'contract-1',
        tenantId: 'tenant-1',
        title: 'NDA',
        contractTypeId: 'contract-type-1',
        signatoryName: 'Vendor Signatory',
        signatoryDesignation: 'Director',
        signatoryEmail: 'vendor@example.com',
        backgroundOfRequest: 'Need contract execution',
        departmentId: 'department-1',
        budgetApproved: true,
        requestCreatedAt: new Date().toISOString(),
        uploadedByEmployeeId: 'employee-1',
        uploadedByEmail: 'legal@nxtwave.co.in',
        currentAssigneeEmployeeId: 'employee-1',
        currentAssigneeEmail: 'legal@nxtwave.co.in',
        status: 'COMPLETED',
        filePath: 'tenant-1/contract-1/agreement.pdf',
        fileName: 'agreement.pdf',
        fileSizeBytes: 1024,
        fileMimeType: 'application/pdf',
      }),
      createCounterparties: jest.fn().mockResolvedValue([
        {
          id: 'counterparty-1',
          tenantId: 'tenant-1',
          contractId: 'contract-1',
          counterpartyName: 'Acme Corp',
          sequenceOrder: 1,
        },
      ]),
      setCounterpartyName: jest.fn().mockResolvedValue(undefined),
      createDocument: jest.fn().mockResolvedValue(undefined),
      upsertMasterCounterpartyNames: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.uploadContract(
        buildUploadInput({
          counterpartyName: 'Acme Corp',
          supportingFiles: [],
        }) as never
      )
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'COUNTERPARTY_SUPPORTING_REQUIRED',
    })

    expect(contractRepository.createWithAudit).not.toHaveBeenCalled()
  })
})

describe('ContractUploadService replace primary document', () => {
  const buildReplaceInput = (overrides?: Record<string, unknown>) => ({
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    uploadedByEmployeeId: 'legal-1',
    uploadedByEmail: 'legal@nxtwave.co.in',
    uploadedByRole: 'LEGAL_TEAM',
    fileName: 'contract-v2.pdf',
    fileSizeBytes: 2048,
    fileMimeType: 'application/pdf',
    fileBody: new Blob([new Uint8Array([1, 2, 3])]),
    isFinalExecuted: false,
    ...overrides,
  })

  const buildContractForReplacement = (overrides?: Record<string, unknown>) => ({
    id: 'contract-1',
    tenantId: 'tenant-1',
    uploadedByEmployeeId: 'legal-1',
    currentAssigneeEmployeeId: 'legal-1',
    status: contractStatuses.completed,
    currentDocumentId: 'doc-1',
    filePath: 'tenant-1/contract-1/versions/v1.pdf',
    fileName: 'v1.pdf',
    ...overrides,
  })

  const buildReplacedDocument = () => ({
    id: 'doc-2',
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    documentKind: 'PRIMARY',
    versionNumber: 2,
    displayName: 'Primary Contract',
    fileName: 'contract-v2.pdf',
    filePath: 'tenant-1/contract-1/versions/v2.pdf',
    fileSizeBytes: 2048,
    fileMimeType: 'application/pdf',
    createdAt: new Date().toISOString(),
  })

  it('runs document version replace and status update concurrently when final executed is checked', async () => {
    let statusUpdateStarted = false
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue(buildContractForReplacement()),
      replacePrimaryDocument: jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(statusUpdateStarted).toBe(true)
        return buildReplacedDocument()
      }),
      updateContractStatus: jest.fn().mockImplementation(async () => {
        statusUpdateStarted = true
      }),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await service.replacePrimaryDocument(buildReplaceInput({ isFinalExecuted: true }) as never)

    expect(contractRepository.replacePrimaryDocument).toHaveBeenCalledTimes(1)
    expect(contractRepository.updateContractStatus).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      status: contractStatuses.executed,
    })
  })

  it('moves replacement back to UNDER_REVIEW when final executed is not checked', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue(buildContractForReplacement({ status: contractStatuses.completed })),
      replacePrimaryDocument: jest.fn().mockResolvedValue(buildReplacedDocument()),
      updateContractStatus: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await service.replacePrimaryDocument(buildReplaceInput({ isFinalExecuted: false }) as never)

    expect(contractRepository.replacePrimaryDocument).toHaveBeenCalledTimes(1)
    expect(contractRepository.updateContractStatus).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      status: contractStatuses.underReview,
    })
  })

  it('keeps status in HOD_PENDING when POC uploader replaces while HOD approval is pending', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue(
        buildContractForReplacement({
          uploadedByEmployeeId: 'poc-1',
          status: contractStatuses.hodPending,
        })
      ),
      replacePrimaryDocument: jest.fn().mockResolvedValue(buildReplacedDocument()),
      updateContractStatus: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await service.replacePrimaryDocument(
      buildReplaceInput({
        uploadedByEmployeeId: 'poc-1',
        uploadedByRole: 'POC',
        uploadedByEmail: 'poc@nxtwave.co.in',
      }) as never
    )

    expect(contractRepository.replacePrimaryDocument).toHaveBeenCalledTimes(1)
    expect(contractRepository.updateContractStatus).not.toHaveBeenCalled()
  })

  it('routes to HOD_PENDING when POC uploader replaces a rejected contract', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue(
        buildContractForReplacement({
          uploadedByEmployeeId: 'poc-1',
          status: contractStatuses.rejected,
        })
      ),
      replacePrimaryDocument: jest.fn().mockResolvedValue(buildReplacedDocument()),
      updateContractStatus: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await service.replacePrimaryDocument(
      buildReplaceInput({
        uploadedByEmployeeId: 'poc-1',
        uploadedByRole: 'POC',
        uploadedByEmail: 'poc@nxtwave.co.in',
      }) as never
    )

    expect(contractRepository.replacePrimaryDocument).toHaveBeenCalledTimes(1)
    expect(contractRepository.updateContractStatus).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      status: contractStatuses.hodPending,
    })
  })

  it('allows original uploader POC to replace even when not legal/admin', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue(
        buildContractForReplacement({
          uploadedByEmployeeId: 'poc-1',
          status: contractStatuses.onHold,
        })
      ),
      replacePrimaryDocument: jest.fn().mockResolvedValue(buildReplacedDocument()),
      updateContractStatus: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await service.replacePrimaryDocument(
      buildReplaceInput({
        uploadedByEmployeeId: 'poc-1',
        uploadedByRole: 'POC',
        uploadedByEmail: 'poc@nxtwave.co.in',
      }) as never
    )

    expect(contractRepository.replacePrimaryDocument).toHaveBeenCalledTimes(1)
  })

  it('blocks replacement for non-uploader non-legal users', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue(
        buildContractForReplacement({
          uploadedByEmployeeId: 'poc-1',
          status: contractStatuses.onHold,
        })
      ),
      replacePrimaryDocument: jest.fn(),
      updateContractStatus: jest.fn(),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.replacePrimaryDocument(
        buildReplaceInput({
          uploadedByEmployeeId: 'poc-2',
          uploadedByRole: 'POC',
          uploadedByEmail: 'other.poc@nxtwave.co.in',
        }) as never
      )
    ).rejects.toMatchObject<Partial<AuthorizationError>>({
      code: 'CONTRACT_REPLACEMENT_FORBIDDEN',
    })

    expect(contractRepository.replacePrimaryDocument).not.toHaveBeenCalled()
  })
})

describe('ContractUploadService replace supporting document', () => {
  const buildReplaceInput = (overrides?: Record<string, unknown>) => ({
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    sourceDocumentId: 'supporting-doc-1',
    uploadedByEmployeeId: 'legal-1',
    uploadedByEmail: 'legal@nxtwave.co.in',
    uploadedByRole: 'LEGAL_TEAM',
    fileName: 'supporting-v2.pdf',
    fileSizeBytes: 2048,
    fileMimeType: 'application/pdf',
    fileBody: new Blob([new Uint8Array([1, 2, 3])]),
    ...overrides,
  })

  const buildContractForReplacement = (overrides?: Record<string, unknown>) => ({
    id: 'contract-1',
    tenantId: 'tenant-1',
    uploadedByEmployeeId: 'legal-1',
    currentAssigneeEmployeeId: 'legal-1',
    status: contractStatuses.completed,
    currentDocumentId: 'doc-1',
    filePath: 'tenant-1/contract-1/versions/v1.pdf',
    fileName: 'v1.pdf',
    ...overrides,
  })

  const buildSupportingDocument = (overrides?: Record<string, unknown>) => ({
    id: 'supporting-doc-1',
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    documentKind: 'COUNTERPARTY_SUPPORTING',
    counterpartyId: 'counterparty-1',
    displayName: 'Counterparty Docs - Acme Corp (1)',
    versionNumber: 1,
    filePath: 'tenant-1/contract-1/counterparty/001/001-supporting.pdf',
    fileName: 'supporting.pdf',
    ...overrides,
  })

  it('replaces supporting document for legal/admin or original uploader when not in signing', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue(buildContractForReplacement()),
      getDocumentForAccess: jest.fn().mockResolvedValue(buildSupportingDocument()),
      replaceSupportingDocument: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)
    await service.replaceSupportingDocument(buildReplaceInput() as never)

    expect(contractStorageRepository.upload).toHaveBeenCalledTimes(1)
    expect(contractRepository.replaceSupportingDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDocumentId: 'supporting-doc-1',
        counterpartyId: 'counterparty-1',
      })
    )
  })

  it('blocks supporting replacement once contract enters SIGNING', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue(buildContractForReplacement({ status: contractStatuses.signing })),
      getDocumentForAccess: jest.fn(),
      replaceSupportingDocument: jest.fn(),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(service.replaceSupportingDocument(buildReplaceInput() as never)).rejects.toMatchObject<
      Partial<BusinessRuleError>
    >({
      code: 'CONTRACT_IN_SIGNATURE_REPLACEMENT_FORBIDDEN',
    })

    expect(contractStorageRepository.upload).not.toHaveBeenCalled()
    expect(contractRepository.replaceSupportingDocument).not.toHaveBeenCalled()
  })

  it('blocks supporting replacement for non-uploader non-legal actor', async () => {
    const contractRepository = {
      getForAccess: jest.fn().mockResolvedValue(
        buildContractForReplacement({
          uploadedByEmployeeId: 'poc-1',
          status: contractStatuses.onHold,
        })
      ),
      getDocumentForAccess: jest.fn().mockResolvedValue(buildSupportingDocument()),
      replaceSupportingDocument: jest.fn(),
    }

    const contractStorageRepository = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)

    await expect(
      service.replaceSupportingDocument(
        buildReplaceInput({
          uploadedByEmployeeId: 'poc-2',
          uploadedByRole: 'POC',
          uploadedByEmail: 'other.poc@nxtwave.co.in',
        }) as never
      )
    ).rejects.toMatchObject<Partial<AuthorizationError>>({
      code: 'CONTRACT_REPLACEMENT_FORBIDDEN',
    })
    expect(contractStorageRepository.upload).not.toHaveBeenCalled()
  })
})

describe('ContractUploadService direct-to-storage init/finalize', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const buildDirectUploadInput = () => ({
    tenantId: 'tenant-1',
    uploadedByEmployeeId: 'admin-1',
    uploadedByEmail: 'admin@nxtwave.co.in',
    uploadedByRole: 'ADMIN',
    uploadMode: contractUploadModes.default,
    title: 'Master Service Agreement',
    contractTypeId: 'type-1',
    signatoryName: 'NA',
    signatoryDesignation: 'NA',
    signatoryEmail: 'NA',
    backgroundOfRequest: 'NA',
    departmentId: 'dept-1',
    budgetApproved: false,
    counterparties: [
      {
        counterpartyName: 'NA',
        supportingFiles: [],
        signatories: [],
      },
    ],
    file: {
      fileName: 'direct-upload.docx',
      fileSizeBytes: 1024,
      fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    supportingFiles: [],
  })

  it('creates signed upload plan for primary document', async () => {
    const contractRepository = {}
    const contractStorageRepository = {
      createSignedUploadUrl: jest.fn().mockImplementation(async (path: string) => ({
        path,
        token: 'token-1',
        signedUrl: `https://upload.example/${encodeURIComponent(path)}`,
      })),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)
    const result = await service.initiateUploadContract(buildDirectUploadInput())

    expect(result.contractId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(result.primaryUpload.path).toContain(`tenant-1/${result.contractId}/`)
    expect(result.primaryUpload.fileName).toBe('direct-upload.docx')
    expect(contractStorageRepository.createSignedUploadUrl).toHaveBeenCalledTimes(1)
  })

  it('finalizes metadata-only upload when files exist in storage', async () => {
    const contractRepository = {
      createWithAudit: jest.fn().mockResolvedValue({
        id: 'contract-1',
        title: 'Master Service Agreement',
        status: contractStatuses.uploaded,
        currentAssigneeEmployeeId: 'legal-1',
        currentAssigneeEmail: 'legal@nxtwave.co.in',
        fileName: 'direct-upload.docx',
        fileSizeBytes: 1024,
      }),
      createCounterparties: jest.fn().mockResolvedValue([{ id: 'cp-1', sequenceOrder: 1 }]),
      setCounterpartyName: jest.fn().mockResolvedValue(undefined),
      createDocument: jest.fn().mockResolvedValue(undefined),
      upsertMasterCounterpartyNames: jest.fn().mockResolvedValue(undefined),
      seedSigningPreparationDraft: jest.fn().mockResolvedValue(undefined),
    }

    const contractStorageRepository = {
      exists: jest.fn().mockResolvedValue(true),
    }

    const service = new ContractUploadService(contractRepository as never, contractStorageRepository as never, logger)
    const result = await service.finalizeUploadContract({
      ...buildDirectUploadInput(),
      contractId: '0d9d53a8-0f15-4dd0-ae8b-2ec672f11f92',
    })

    expect(contractStorageRepository.exists).toHaveBeenCalled()
    expect(contractRepository.createWithAudit).toHaveBeenCalled()
    expect(contractRepository.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentKind: 'PRIMARY',
        fileName: 'direct-upload.docx',
      })
    )
    expect(result.id).toBe('contract-1')
  })
})
