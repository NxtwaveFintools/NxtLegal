import { ContractQueryService } from '@/core/domain/contracts/contract-query-service'
import type { ContractDetail, ContractQueryRepository } from '@/core/domain/contracts/contract-query-repository'
import { AuthorizationError, BusinessRuleError } from '@/core/http/errors'

const baseContract: ContractDetail = {
  id: 'contract-1',
  title: 'Master Service Agreement',
  contractTypeId: 'contract-type-1',
  contractTypeName: 'MSA',
  status: 'HOD_PENDING',
  uploadedByEmployeeId: 'uploader-1',
  uploadedByEmail: 'poc@nxtwave.co.in',
  currentAssigneeEmployeeId: 'hod-1',
  currentAssigneeEmail: 'hod@nxtwave.co.in',
  departmentId: 'department-1',
  departmentName: 'Facilities',
  departmentHodName: 'Bala Bhaskar',
  departmentHodEmail: 'balabhaskar@nxtwave.co.in',
  signatoryName: 'John Doe',
  signatoryDesignation: 'Manager',
  signatoryEmail: 'john.doe@nxtwave.co.in',
  backgroundOfRequest: 'Office fitout contract',
  budgetApproved: true,
  requestCreatedAt: new Date().toISOString(),
  fileName: 'msa.docx',
  fileSizeBytes: 1024,
  fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  filePath: 'tenant/contract-1/msa.docx',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  rowVersion: 1,
}

const createRepositoryMock = (): jest.Mocked<ContractQueryRepository> => ({
  listByTenant: jest.fn(),
  getPendingApprovalsForRole: jest.fn(),
  getDashboardContracts: jest.fn(),
  getDashboardFilterCount: jest.fn(),
  getActionableAdditionalApprovals: jest.fn(),
  getAdditionalApproverDecisionHistory: jest.fn(),
  listRepositoryContracts: jest.fn(),
  getRepositoryReport: jest.fn(),
  updateTitle: jest.fn(),
  listRepositoryExportRows: jest.fn(),
  listRepositoryExportRowsChunk: jest.fn(),
  getById: jest.fn(),
  getCounterparties: jest.fn(),
  getDocuments: jest.fn(),
  getTimeline: jest.fn(),
  getAdditionalApprovers: jest.fn(),
  getLegalCollaborators: jest.fn(),
  listActiveTenantLegalMembers: jest.fn(),
  isLegalCollaborator: jest.fn(),
  getSignatories: jest.fn(),
  canAccessContract: jest.fn(),
  getAvailableActions: jest.fn(),
  applyAction: jest.fn(),
  addAdditionalApprover: jest.fn(),
  updateLegalMetadata: jest.fn(),
  bypassAdditionalApprover: jest.fn(),
  setLegalOwnerByEmail: jest.fn(),
  addLegalCollaboratorByEmail: jest.fn(),
  removeLegalCollaboratorByEmail: jest.fn(),
  addSignatory: jest.fn(),
  saveSigningPreparationDraft: jest.fn(),
  getSigningPreparationDraft: jest.fn(),
  countPendingSignatoriesByContract: jest.fn(),
  moveContractToInSignature: jest.fn(),
  softResetActiveSigningCycle: jest.fn(),
  deleteSigningPreparationDraft: jest.fn(),
  resolveEnvelopeContext: jest.fn(),
  recordZohoSignWebhookEvent: jest.fn(),
  addSignatoryWebhookAuditEvent: jest.fn(),
  markSignatoryAsSigned: jest.fn(),
  listFailedNotificationDeliveries: jest.fn(),
  getEnvelopeNotificationProfile: jest.fn(),
  getLatestNotificationDelivery: jest.fn(),
  recordContractNotificationDelivery: jest.fn(),
  addContractNote: jest.fn(),
  addContractActivityMessage: jest.fn(),
  markContractActivitySeen: jest.fn(),
})

describe('ContractQueryService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns success payload when action succeeds but actor loses read access post-mutation', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    const updatedContract: ContractDetail = {
      ...baseContract,
      status: 'UNDER_REVIEW',
      currentAssigneeEmployeeId: 'legal-1',
      currentAssigneeEmail: 'legalteam@nxtwave.co.in',
      rowVersion: 2,
    }

    repository.applyAction.mockResolvedValue({
      contract: updatedContract,
      previousStatus: 'HOD_PENDING',
    })
    repository.getById.mockResolvedValue(updatedContract)
    repository.canAccessContract.mockResolvedValue(false)

    const result = await service.applyContractAction({
      tenantId: 'tenant-1',
      contractId: updatedContract.id,
      action: 'hod.approve',
      actorEmployeeId: 'hod-1',
      actorRole: 'HOD',
      actorEmail: 'hod@nxtwave.co.in',
    })

    expect(result).toEqual({
      contractView: {
        contract: updatedContract,
        counterparties: [],
        documents: [],
        availableActions: [],
        additionalApprovers: [],
        legalCollaborators: [],
        signatories: [],
      },
      previousStatus: 'HOD_PENDING',
    })
  })

  it('delegates contract access decisions to repository for role-aware visibility', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.getById.mockResolvedValue(baseContract)
    repository.canAccessContract.mockResolvedValue(true)
    repository.getDocuments.mockResolvedValue([])
    repository.getAvailableActions.mockResolvedValue([])
    repository.getAdditionalApprovers.mockResolvedValue([])
    repository.getLegalCollaborators.mockResolvedValue([])
    repository.getSignatories.mockResolvedValue([])
    repository.getCounterparties.mockResolvedValue([])

    await service.getContractDetail({
      tenantId: 'tenant-1',
      contractId: baseContract.id,
      employeeId: 'hod-1',
      role: 'HOD',
    })

    expect(repository.canAccessContract).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorEmployeeId: 'hod-1',
      actorRole: 'HOD',
      contract: baseContract,
    })
  })

  it('still throws non-access errors after mutation', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.applyAction.mockResolvedValue({
      contract: baseContract,
      previousStatus: 'HOD_PENDING',
    })
    repository.getById.mockResolvedValue(baseContract)
    repository.canAccessContract.mockRejectedValue(
      new AuthorizationError('CONTRACT_TIMELINE_FORBIDDEN', 'timeline unavailable')
    )

    await expect(
      service.applyContractAction({
        tenantId: 'tenant-1',
        contractId: baseContract.id,
        action: 'hod.approve',
        actorEmployeeId: 'hod-1',
        actorRole: 'HOD',
        actorEmail: 'hod@nxtwave.co.in',
      })
    ).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('delegates pending approvals to repository with actor role context', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.getPendingApprovalsForRole.mockResolvedValue([baseContract])

    const result = await service.getPendingApprovalsForRole({
      tenantId: 'tenant-1',
      employeeId: 'hod-1',
      role: 'HOD',
      limit: 20,
    })

    expect(result).toHaveLength(1)
    expect(repository.getPendingApprovalsForRole).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      employeeId: 'hod-1',
      role: 'HOD',
      limit: 20,
    })
  })

  it('delegates dashboard contracts with requested filter', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.getDashboardContracts.mockResolvedValue({
      items: [baseContract],
      nextCursor: undefined,
      total: 1,
    })

    const result = await service.getDashboardContracts({
      tenantId: 'tenant-1',
      employeeId: 'poc-1',
      role: 'POC',
      filter: 'HOD_PENDING',
      limit: 20,
    })

    expect(result.items).toHaveLength(1)
    expect(repository.getDashboardContracts).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      employeeId: 'poc-1',
      role: 'POC',
      filter: 'HOD_PENDING',
      limit: 20,
    })
  })

  it('preserves repository total count for list contracts', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.listByTenant.mockResolvedValue({
      items: [baseContract],
      nextCursor: undefined,
      total: 37,
    })

    const result = await service.listContracts({
      tenantId: 'tenant-1',
      employeeId: 'poc-1',
      role: 'POC',
      limit: 20,
    })

    expect(result.total).toBe(37)
  })

  it('preserves repository total count for dashboard contracts', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.getDashboardContracts.mockResolvedValue({
      items: [baseContract],
      nextCursor: undefined,
      total: 11,
    })

    const result = await service.getDashboardContracts({
      tenantId: 'tenant-1',
      employeeId: 'poc-1',
      role: 'POC',
      filter: 'HOD_PENDING',
      limit: 20,
    })

    expect(result.total).toBe(11)
  })

  it('delegates actionable additional approvals to repository', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.getActionableAdditionalApprovals.mockResolvedValue([baseContract])

    const result = await service.getActionableAdditionalApprovals({
      tenantId: 'tenant-1',
      employeeId: 'approver-1',
      limit: 10,
    })

    expect(result).toHaveLength(1)
    expect(repository.getActionableAdditionalApprovals).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      employeeId: 'approver-1',
      limit: 10,
    })
  })

  it('delegates additional approver decision history to repository', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.getAdditionalApproverDecisionHistory.mockResolvedValue({
      items: [
        {
          contractId: baseContract.id,
          contractTitle: baseContract.title,
          contractStatus: baseContract.status,
          contractDisplayStatusLabel: 'HOD Pending',
          departmentId: 'department-1',
          departmentName: 'Facilities',
          actorEmail: 'approver@nxtwave.co.in',
          decision: 'APPROVED',
          decidedAt: new Date().toISOString(),
          reason: null,
        },
      ],
      nextCursor: undefined,
      total: 1,
    })

    const result = await service.getAdditionalApproverDecisionHistory({
      tenantId: 'tenant-1',
      employeeId: 'approver-1',
      role: 'USER',
      limit: 10,
    })

    expect(result.items).toHaveLength(1)
    expect(repository.getAdditionalApproverDecisionHistory).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      employeeId: 'approver-1',
      role: 'USER',
      limit: 10,
    })
  })

  it('preserves repository total count for repository listing', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.listRepositoryContracts.mockResolvedValue({
      items: [baseContract],
      total: 24,
    })

    const result = await service.listRepositoryContracts({
      tenantId: 'tenant-1',
      employeeId: 'legal-1',
      role: 'LEGAL_TEAM',
      page: 1,
      limit: 20,
      sortBy: 'created_at',
      sortDirection: 'desc',
    })

    expect(result.total).toBe(24)
  })

  it('requires remark for additional approver rejection action', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    await expect(
      service.applyContractAction({
        tenantId: 'tenant-1',
        contractId: baseContract.id,
        action: 'approver.reject',
        actorEmployeeId: 'approver-1',
        actorRole: 'USER',
        actorEmail: 'approver@nxtwave.co.in',
      })
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'REMARK_REQUIRED',
    })

    expect(repository.applyAction).not.toHaveBeenCalled()
  })

  it('forwards optional note when approving as additional approver', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    const updatedContract: ContractDetail = {
      ...baseContract,
      status: 'UNDER_REVIEW',
      currentAssigneeEmployeeId: 'legal-1',
      currentAssigneeEmail: 'legalteam@nxtwave.co.in',
      rowVersion: 2,
    }

    repository.applyAction.mockResolvedValue({
      contract: updatedContract,
      previousStatus: 'HOD_PENDING',
    })
    repository.getById.mockResolvedValue(updatedContract)
    repository.canAccessContract.mockResolvedValue(true)
    repository.getCounterparties.mockResolvedValue([])
    repository.getDocuments.mockResolvedValue([])
    repository.getAvailableActions.mockResolvedValue([])
    repository.getAdditionalApprovers.mockResolvedValue([])
    repository.getLegalCollaborators.mockResolvedValue([])
    repository.getSignatories.mockResolvedValue([])

    await service.applyContractAction({
      tenantId: 'tenant-1',
      contractId: updatedContract.id,
      action: 'approver.approve',
      actorEmployeeId: 'approver-1',
      actorRole: 'USER',
      actorEmail: 'approver@nxtwave.co.in',
      noteText: 'Approved after reviewing latest revision',
    })

    expect(repository.applyAction).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: updatedContract.id,
      action: 'approver.approve',
      actorEmployeeId: 'approver-1',
      actorRole: 'USER',
      actorEmail: 'approver@nxtwave.co.in',
      noteText: 'Approved after reviewing latest revision',
    })
  })

  it('forwards optional note when adding additional approver', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    const updatedContract: ContractDetail = {
      ...baseContract,
      status: 'UNDER_REVIEW',
      currentAssigneeEmployeeId: 'legal-1',
      currentAssigneeEmail: 'legalteam@nxtwave.co.in',
      rowVersion: 2,
    }

    repository.addAdditionalApprover.mockResolvedValue(undefined)
    repository.getById.mockResolvedValue(updatedContract)
    repository.canAccessContract.mockResolvedValue(true)
    repository.getCounterparties.mockResolvedValue([])
    repository.getDocuments.mockResolvedValue([])
    repository.getAvailableActions.mockResolvedValue([])
    repository.getAdditionalApprovers.mockResolvedValue([])
    repository.getLegalCollaborators.mockResolvedValue([])
    repository.getSignatories.mockResolvedValue([])

    await service.addAdditionalApprover({
      tenantId: 'tenant-1',
      contractId: updatedContract.id,
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legalteam@nxtwave.co.in',
      approverEmail: 'approver@nxtwave.co.in',
      noteText: 'Please verify budget and indemnity clauses',
    })

    expect(repository.addAdditionalApprover).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: updatedContract.id,
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legalteam@nxtwave.co.in',
      approverEmail: 'approver@nxtwave.co.in',
      noteText: 'Please verify budget and indemnity clauses',
    })
  })

  it('restricts individual approval bypass to LEGAL_TEAM or ADMIN', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    await expect(
      service.bypassAdditionalApprover({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        approverId: 'approver-row-1',
        actorEmployeeId: 'user-1',
        actorRole: 'HOD',
        actorEmail: 'hod@nxtwave.co.in',
        reason: 'Need to continue legal processing',
      })
    ).rejects.toMatchObject<Partial<AuthorizationError>>({
      code: 'CONTRACT_ACTION_FORBIDDEN',
    })

    expect(repository.bypassAdditionalApprover).not.toHaveBeenCalled()
  })

  it('delegates individual approval bypass and returns refreshed detail view', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    const updatedContract: ContractDetail = {
      ...baseContract,
      status: 'UNDER_REVIEW',
      currentAssigneeEmployeeId: 'legal-1',
      currentAssigneeEmail: 'legalteam@nxtwave.co.in',
      rowVersion: 2,
    }

    repository.bypassAdditionalApprover.mockResolvedValue(undefined)
    repository.getById.mockResolvedValue(updatedContract)
    repository.canAccessContract.mockResolvedValue(true)
    repository.getCounterparties.mockResolvedValue([])
    repository.getDocuments.mockResolvedValue([])
    repository.getAvailableActions.mockResolvedValue([])
    repository.getAdditionalApprovers.mockResolvedValue([])
    repository.getLegalCollaborators.mockResolvedValue([])
    repository.getSignatories.mockResolvedValue([])

    const result = await service.bypassAdditionalApprover({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      approverId: 'approver-row-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legalteam@nxtwave.co.in',
      reason: 'Approver is unavailable and SLA is at risk',
    })

    expect(repository.bypassAdditionalApprover).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      approverId: 'approver-row-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      actorEmail: 'legalteam@nxtwave.co.in',
      reason: 'Approver is unavailable and SLA is at risk',
    })
    expect(result.contract.status).toBe('UNDER_REVIEW')
  })

  it('saves signing preparation draft when contract is completed', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    const completedContract: ContractDetail = {
      ...baseContract,
      status: 'COMPLETED',
    }

    repository.getById.mockResolvedValue(completedContract)
    repository.canAccessContract.mockResolvedValue(true)
    repository.getDocuments.mockResolvedValue([])
    repository.getAvailableActions.mockResolvedValue([])
    repository.getAdditionalApprovers.mockResolvedValue([])
    repository.getLegalCollaborators.mockResolvedValue([])
    repository.getSignatories.mockResolvedValue([])
    repository.saveSigningPreparationDraft.mockResolvedValue({
      contractId: 'contract-1',
      recipients: [
        {
          name: 'Shriya Mattoo',
          email: 'shriya@example.com',
          recipientType: 'INTERNAL',
          routingOrder: 1,
        },
      ],
      fields: [
        {
          fieldType: 'SIGNATURE',
          pageNumber: 1,
          xPosition: 100,
          yPosition: 120,
          anchorString: null,
          assignedSignerEmail: 'shriya@example.com',
        },
      ],
      createdByEmployeeId: 'legal-1',
      updatedByEmployeeId: 'legal-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const result = await service.saveSigningPreparationDraft({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      actorRole: 'LEGAL_TEAM',
      recipients: [
        {
          name: 'Shriya Mattoo',
          email: 'shriya@example.com',
          recipientType: 'INTERNAL',
          routingOrder: 1,
        },
      ],
      fields: [
        {
          fieldType: 'SIGNATURE',
          pageNumber: 1,
          xPosition: 100,
          yPosition: 120,
          anchorString: null,
          assignedSignerEmail: 'shriya@example.com',
        },
      ],
    })

    expect(result.contractId).toBe('contract-1')
    expect(repository.saveSigningPreparationDraft).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      actorEmployeeId: 'legal-1',
      recipients: [
        {
          name: 'Shriya Mattoo',
          email: 'shriya@example.com',
          recipientType: 'INTERNAL',
          routingOrder: 1,
        },
      ],
      fields: [
        {
          fieldType: 'SIGNATURE',
          pageNumber: 1,
          xPosition: 100,
          yPosition: 120,
          anchorString: null,
          assignedSignerEmail: 'shriya@example.com',
        },
      ],
    })
  })

  it('rejects signing preparation draft save when contract is not completed', async () => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.getById.mockResolvedValue(baseContract)
    repository.canAccessContract.mockResolvedValue(true)
    repository.getDocuments.mockResolvedValue([])
    repository.getAvailableActions.mockResolvedValue([])
    repository.getAdditionalApprovers.mockResolvedValue([])
    repository.getLegalCollaborators.mockResolvedValue([])
    repository.getSignatories.mockResolvedValue([])

    await expect(
      service.saveSigningPreparationDraft({
        tenantId: 'tenant-1',
        contractId: 'contract-1',
        actorEmployeeId: 'legal-1',
        actorRole: 'LEGAL_TEAM',
        recipients: [
          {
            name: 'Shriya Mattoo',
            email: 'shriya@example.com',
            recipientType: 'INTERNAL',
            routingOrder: 1,
          },
        ],
        fields: [],
      })
    ).rejects.toMatchObject<Partial<BusinessRuleError>>({
      code: 'SIGNING_PREPARATION_INVALID_STATUS',
    })

    expect(repository.saveSigningPreparationDraft).not.toHaveBeenCalled()
  })
})

describe('getContractRowPreview', () => {
  const buildService = () => {
    const repository = createRepositoryMock()
    repository.getById.mockResolvedValue(baseContract)
    repository.canAccessContract.mockResolvedValue(true)
    repository.getCounterparties.mockResolvedValue([])
    repository.getAdditionalApprovers.mockResolvedValue([])
    repository.getSignatories.mockResolvedValue([])
    repository.getTimeline.mockResolvedValue([])
    const service = new ContractQueryService(repository)
    return { repository, service }
  }

  const params = {
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    employeeId: 'employee-1',
    role: 'LEGAL_TEAM',
  }

  it('throws AuthorizationError when the actor cannot access the contract', async () => {
    const { repository, service } = buildService()
    repository.canAccessContract.mockResolvedValue(false)

    await expect(service.getContractRowPreview(params)).rejects.toThrow(AuthorizationError)
  })

  it('does not query approvers or signers when access is denied', async () => {
    const { repository, service } = buildService()
    repository.canAccessContract.mockResolvedValue(false)

    await expect(service.getContractRowPreview(params)).rejects.toThrow(AuthorizationError)
    expect(repository.getAdditionalApprovers).not.toHaveBeenCalled()
    expect(repository.getSignatories).not.toHaveBeenCalled()
  })

  it('does not fetch the timeline', async () => {
    const { repository, service } = buildService()

    await service.getContractRowPreview(params)

    expect(repository.getTimeline).not.toHaveBeenCalled()
  })

  it('maps the description from the contract entity', async () => {
    const { service } = buildService()

    const preview = await service.getContractRowPreview(params)

    expect(preview.description).toBe('Office fitout contract')
    expect(preview.hodApprovedAt).toBeNull()
  })

  it('returns empty collections and zero counts when nothing is attached', async () => {
    const { service } = buildService()

    const preview = await service.getContractRowPreview(params)

    expect(preview.additionalApprovers).toEqual([])
    expect(preview.signatories).toEqual([])
    expect(preview.totalApprovers).toBe(0)
    expect(preview.totalSigners).toBe(0)
  })

  it('counts approved approvers and excludes SKIPPED from the total', async () => {
    const { repository, service } = buildService()
    repository.getAdditionalApprovers.mockResolvedValue([
      {
        id: 'a1',
        approverEmployeeId: 'e1',
        approverEmail: 'anil@nxtwave.co.in',
        sequenceOrder: 1,
        status: 'APPROVED',
        approvedAt: '2026-07-08T00:00:00.000Z',
      },
      {
        id: 'a2',
        approverEmployeeId: 'e2',
        approverEmail: 'meera@nxtwave.co.in',
        sequenceOrder: 2,
        status: 'PENDING',
        approvedAt: null,
      },
      {
        id: 'a3',
        approverEmployeeId: 'e3',
        approverEmail: 'skipped@nxtwave.co.in',
        sequenceOrder: 3,
        status: 'SKIPPED',
        approvedAt: null,
      },
    ])

    const preview = await service.getContractRowPreview(params)

    expect(preview.approvedCount).toBe(1)
    expect(preview.totalApprovers).toBe(2)
    expect(preview.additionalApprovers).toHaveLength(3)
    expect(preview.additionalApprovers.map((approver) => approver.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('preserves distinct ids when the same person approves more than once', async () => {
    const { repository, service } = buildService()
    repository.getAdditionalApprovers.mockResolvedValue([
      {
        id: 'a1',
        approverEmployeeId: 'e1',
        approverEmail: 'repeat@nxtwave.co.in',
        sequenceOrder: 1,
        status: 'APPROVED',
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      {
        id: 'a2',
        approverEmployeeId: 'e1',
        approverEmail: 'repeat@nxtwave.co.in',
        sequenceOrder: 2,
        status: 'PENDING',
        approvedAt: null,
      },
    ])

    const preview = await service.getContractRowPreview(params)

    const ids = preview.additionalApprovers.map((approver) => approver.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('counts signed signatories', async () => {
    const { repository, service } = buildService()
    repository.getSignatories.mockResolvedValue([
      {
        id: 's1',
        signatoryEmail: 'priya@nxtwave.co.in',
        recipientType: 'INTERNAL',
        routingOrder: 1,
        fieldConfig: [],
        status: 'SIGNED',
        signedAt: '2026-07-14T00:00:00.000Z',
        zohoSignEnvelopeId: 'env-1',
        zohoSignRecipientId: 'rec-1',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 's2',
        signatoryEmail: 'cfo@acme.com',
        recipientType: 'EXTERNAL',
        routingOrder: 2,
        fieldConfig: [],
        status: 'PENDING',
        signedAt: null,
        zohoSignEnvelopeId: 'env-1',
        zohoSignRecipientId: 'rec-2',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
    ])

    const preview = await service.getContractRowPreview(params)

    expect(preview.signedCount).toBe(1)
    expect(preview.totalSigners).toBe(2)
    expect(preview.signatories[0].email).toBe('priya@nxtwave.co.in')
    expect(preview.signatories.map((signer) => signer.id)).toEqual(['s1', 's2'])
  })

  it('maps counterparty names in sequence order', async () => {
    const { repository, service } = buildService()
    repository.getCounterparties.mockResolvedValue([
      { id: 'c1', counterpartyName: 'Acme Corp', sequenceOrder: 1 },
      { id: 'c2', counterpartyName: 'Beta Ltd', sequenceOrder: 2 },
    ])

    const preview = await service.getContractRowPreview(params)

    expect(preview.counterparties).toEqual(['Acme Corp', 'Beta Ltd'])
  })
})

describe('getContractDetail downloadFileName', () => {
  const documents = [
    {
      id: 'doc-primary',
      documentKind: 'PRIMARY' as const,
      displayName: 'Contract',
      fileName: 'MSA_Acme.docx',
      fileSizeBytes: 1024,
      fileMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      createdAt: '2026-07-01T10:00:00.000Z',
    },
    {
      id: 'doc-executed',
      documentKind: 'EXECUTED_CONTRACT' as const,
      displayName: 'Executed Contract',
      fileName: 'executed-envelope-123.pdf',
      fileSizeBytes: 2048,
      fileMimeType: 'application/pdf',
      createdAt: '2026-07-20T10:00:00.000Z',
    },
    {
      id: 'doc-certificate',
      documentKind: 'AUDIT_CERTIFICATE' as const,
      displayName: 'Zoho Sign Completion Certificate',
      fileName: 'audit-certificate-envelope-123.pdf',
      fileSizeBytes: 512,
      fileMimeType: 'application/pdf',
      createdAt: '2026-07-20T10:00:00.000Z',
    },
  ]

  const allSigned = [
    { status: 'SIGNED', signedAt: '2026-07-19T10:00:00.000Z' },
    { status: 'SIGNED', signedAt: '2026-07-20T09:30:00.000Z' },
  ]

  const partiallySigned = [
    { status: 'SIGNED', signedAt: '2026-07-19T10:00:00.000Z' },
    { status: 'PENDING', signedAt: null },
  ]

  // Returns the decorated documents from getContractDetail, with the contract
  // titled 'MSA - Acme Corp' and the given signatory set.
  const loadDocuments = async (signatories: Array<{ status: string; signedAt: string | null }>) => {
    const repository = createRepositoryMock()
    const service = new ContractQueryService(repository)

    repository.getById.mockResolvedValue({ ...baseContract, title: 'MSA - Acme Corp' })
    repository.canAccessContract.mockResolvedValue(true)
    repository.getDocuments.mockResolvedValue(documents)
    repository.getSignatories.mockResolvedValue(signatories as never)
    repository.getAvailableActions.mockResolvedValue([])
    repository.getAdditionalApprovers.mockResolvedValue([])
    repository.getLegalCollaborators.mockResolvedValue([])
    repository.getCounterparties.mockResolvedValue([])

    const view = await service.getContractDetail({
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      employeeId: 'emp-1',
      role: 'LEGAL_TEAM',
    })

    return view.documents
  }

  it('gives signing artifacts a friendly download filename', async () => {
    const result = await loadDocuments(allSigned)

    expect(result.find((d) => d.id === 'doc-executed')?.downloadFileName).toBe(
      'MSA - Acme Corp - Signed - 20-07-2026.pdf'
    )
    expect(result.find((d) => d.id === 'doc-certificate')?.downloadFileName).toBe(
      'MSA - Acme Corp - Completion Certificate - 20-07-2026.pdf'
    )
  })

  it('leaves the storage fileName untouched', async () => {
    const result = await loadDocuments(allSigned)

    expect(result.find((d) => d.id === 'doc-executed')?.fileName).toBe('executed-envelope-123.pdf')
  })

  it('falls back to the uploaded filename for primary documents', async () => {
    const result = await loadDocuments(allSigned)

    expect(result.find((d) => d.id === 'doc-primary')?.downloadFileName).toBe('MSA_Acme.docx')
  })

  it('omits the date while signatures are still outstanding', async () => {
    const result = await loadDocuments(partiallySigned)

    expect(result.find((d) => d.id === 'doc-executed')?.downloadFileName).toBe('MSA - Acme Corp - Signed.pdf')
  })
})
