import { AuthorizationError, BusinessRuleError, NotFoundError } from '@/core/http/errors'
import type { ContractStatus } from '@/core/constants/contracts'
import type {
  AdditionalApproverDecisionHistoryItem,
  ContractActivityReadState,
  DashboardContractFilter,
  ContractDetail,
  ContractDetailView,
  ContractListItem,
  ContractQueryRepository,
  RepositorySortBy,
  RepositorySortDirection,
  ContractTimelineEvent,
} from '@/core/domain/contracts/contract-query-repository'
import type { ContractActionName, ContractLegalAssignmentOperation } from '@/core/domain/contracts/schemas'

export class ContractQueryService {
  constructor(private readonly contractRepository: ContractQueryRepository) {}

  async listContracts(params: {
    tenantId: string
    employeeId: string
    role?: string
    cursor?: string
    limit: number
  }): Promise<{ items: ContractListItem[]; nextCursor?: string; total: number }> {
    return this.contractRepository.listByTenant(params)
  }

  async getPendingApprovalsForRole(params: {
    tenantId: string
    employeeId: string
    role?: string
    limit: number
  }): Promise<ContractListItem[]> {
    return this.contractRepository.getPendingApprovalsForRole(params)
  }

  async getDashboardContracts(params: {
    tenantId: string
    employeeId: string
    role?: string
    filter: DashboardContractFilter
    cursor?: string
    limit: number
  }): Promise<{ items: ContractListItem[]; nextCursor?: string; total: number }> {
    return this.contractRepository.getDashboardContracts(params)
  }

  async getActionableAdditionalApprovals(params: {
    tenantId: string
    employeeId: string
    limit: number
  }): Promise<ContractListItem[]> {
    return this.contractRepository.getActionableAdditionalApprovals(params)
  }

  async getAdditionalApproverDecisionHistory(params: {
    tenantId: string
    employeeId: string
    role?: string
    cursor?: string
    limit: number
    departmentId?: string
  }): Promise<{ items: AdditionalApproverDecisionHistoryItem[]; nextCursor?: string; total: number }> {
    return this.contractRepository.getAdditionalApproverDecisionHistory(params)
  }

  async listRepositoryContracts(params: {
    tenantId: string
    employeeId: string
    role?: string
    cursor?: string
    limit: number
    search?: string
    status?: ContractStatus
    sortBy?: RepositorySortBy
    sortDirection?: RepositorySortDirection
  }): Promise<{ items: ContractListItem[]; nextCursor?: string; total: number }> {
    return this.contractRepository.listRepositoryContracts(params)
  }

  async getContractDetail(params: {
    tenantId: string
    contractId: string
    employeeId: string
    role?: string
  }): Promise<ContractDetailView> {
    const contract = await this.contractRepository.getById(params.tenantId, params.contractId)

    if (!contract) {
      throw new NotFoundError('Contract', params.contractId)
    }

    if (
      !(await this.contractRepository.canAccessContract({
        tenantId: params.tenantId,
        actorEmployeeId: params.employeeId,
        actorRole: params.role,
        contract,
      }))
    ) {
      throw new AuthorizationError('CONTRACT_READ_FORBIDDEN', 'You do not have access to this contract')
    }

    const [counterparties, documents, availableActions, additionalApprovers, legalCollaborators] = await Promise.all([
      this.contractRepository.getCounterparties(params.tenantId, params.contractId),
      this.contractRepository.getDocuments(params.tenantId, params.contractId),
      this.contractRepository.getAvailableActions({
        tenantId: params.tenantId,
        contract,
        actorEmployeeId: params.employeeId,
        actorRole: params.role,
      }),
      this.contractRepository.getAdditionalApprovers(params.tenantId, params.contractId),
      this.contractRepository.getLegalCollaborators(params.tenantId, params.contractId),
    ])

    return {
      contract,
      counterparties,
      documents,
      availableActions,
      additionalApprovers,
      legalCollaborators,
    }
  }

  async getContractTimeline(params: {
    tenantId: string
    contractId: string
    employeeId: string
    role?: string
    limit: number
  }): Promise<ContractTimelineEvent[]> {
    const contract = await this.contractRepository.getById(params.tenantId, params.contractId)

    if (!contract) {
      throw new NotFoundError('Contract', params.contractId)
    }

    if (
      !(await this.contractRepository.canAccessContract({
        tenantId: params.tenantId,
        actorEmployeeId: params.employeeId,
        actorRole: params.role,
        contract,
      }))
    ) {
      throw new AuthorizationError('CONTRACT_TIMELINE_FORBIDDEN', 'You do not have access to this contract timeline')
    }

    return this.contractRepository.getTimeline(params.tenantId, params.contractId, params.limit)
  }

  async applyContractAction(params: {
    tenantId: string
    contractId: string
    action: ContractActionName
    actorEmployeeId: string
    actorRole?: string
    actorEmail: string
    noteText?: string
  }): Promise<ContractDetailView> {
    if (!params.actorRole) {
      throw new AuthorizationError('CONTRACT_ACTION_FORBIDDEN', 'User role is required for contract action')
    }

    if (!params.actorEmail) {
      throw new BusinessRuleError('ACTOR_EMAIL_REQUIRED', 'Actor email is required')
    }

    const isRemarkMandatoryAction =
      params.action === 'legal.query.reroute' ||
      params.action === 'hod.bypass' ||
      params.action === 'hod.reject' ||
      params.action === 'legal.reject' ||
      params.action === 'approver.reject'

    if (isRemarkMandatoryAction) {
      if (!params.noteText?.trim()) {
        throw new BusinessRuleError('REMARK_REQUIRED', 'Remarks are mandatory for this action')
      }
    }

    const updatedContract = await this.contractRepository.applyAction({
      tenantId: params.tenantId,
      contractId: params.contractId,
      action: params.action,
      actorEmployeeId: params.actorEmployeeId,
      actorRole: params.actorRole,
      actorEmail: params.actorEmail,
      noteText: params.noteText,
    })

    return this.getContractDetailAfterMutation({
      tenantId: params.tenantId,
      contractId: params.contractId,
      employeeId: params.actorEmployeeId,
      role: params.actorRole,
      updatedContract,
    })
  }

  async addContractNote(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole?: string
    actorEmail: string
    noteText: string
  }): Promise<ContractDetailView> {
    if (!params.actorRole) {
      throw new AuthorizationError('CONTRACT_NOTE_FORBIDDEN', 'User role is required for adding note')
    }

    if (!params.actorEmail) {
      throw new BusinessRuleError('ACTOR_EMAIL_REQUIRED', 'Actor email is required')
    }

    await this.contractRepository.addContractNote({
      tenantId: params.tenantId,
      contractId: params.contractId,
      actorEmployeeId: params.actorEmployeeId,
      actorRole: params.actorRole,
      actorEmail: params.actorEmail,
      noteText: params.noteText,
    })

    const contract = await this.contractRepository.getById(params.tenantId, params.contractId)

    if (!contract) {
      throw new NotFoundError('Contract', params.contractId)
    }

    return this.getContractDetailAfterMutation({
      tenantId: params.tenantId,
      contractId: params.contractId,
      employeeId: params.actorEmployeeId,
      role: params.actorRole,
      updatedContract: contract,
    })
  }

  async addContractActivityMessage(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole?: string
    actorEmail: string
    messageText: string
  }): Promise<ContractDetailView> {
    if (!params.actorRole) {
      throw new AuthorizationError('CONTRACT_ACTIVITY_FORBIDDEN', 'User role is required for adding activity message')
    }

    if (!params.actorEmail) {
      throw new BusinessRuleError('ACTOR_EMAIL_REQUIRED', 'Actor email is required')
    }

    await this.contractRepository.addContractActivityMessage({
      tenantId: params.tenantId,
      contractId: params.contractId,
      actorEmployeeId: params.actorEmployeeId,
      actorRole: params.actorRole,
      actorEmail: params.actorEmail,
      messageText: params.messageText,
    })

    const contract = await this.contractRepository.getById(params.tenantId, params.contractId)

    if (!contract) {
      throw new NotFoundError('Contract', params.contractId)
    }

    return this.getContractDetailAfterMutation({
      tenantId: params.tenantId,
      contractId: params.contractId,
      employeeId: params.actorEmployeeId,
      role: params.actorRole,
      updatedContract: contract,
    })
  }

  async markContractActivitySeen(params: {
    tenantId: string
    contractId: string
    employeeId: string
    role?: string
  }): Promise<ContractActivityReadState> {
    const contract = await this.contractRepository.getById(params.tenantId, params.contractId)

    if (!contract) {
      throw new NotFoundError('Contract', params.contractId)
    }

    if (
      !(await this.contractRepository.canAccessContract({
        tenantId: params.tenantId,
        actorEmployeeId: params.employeeId,
        actorRole: params.role,
        contract,
      }))
    ) {
      throw new AuthorizationError('CONTRACT_ACTIVITY_FORBIDDEN', 'You do not have access to this contract activity')
    }

    return this.contractRepository.markContractActivitySeen({
      tenantId: params.tenantId,
      contractId: params.contractId,
      employeeId: params.employeeId,
    })
  }

  async addAdditionalApprover(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole?: string
    actorEmail: string
    approverEmail: string
  }): Promise<ContractDetailView> {
    if (!params.actorRole) {
      throw new AuthorizationError('CONTRACT_APPROVER_FORBIDDEN', 'User role is required for adding approver')
    }

    if (!params.actorEmail) {
      throw new BusinessRuleError('ACTOR_EMAIL_REQUIRED', 'Actor email is required')
    }

    await this.contractRepository.addAdditionalApprover({
      tenantId: params.tenantId,
      contractId: params.contractId,
      actorEmployeeId: params.actorEmployeeId,
      actorRole: params.actorRole,
      actorEmail: params.actorEmail,
      approverEmail: params.approverEmail,
    })

    const contract = await this.contractRepository.getById(params.tenantId, params.contractId)

    if (!contract) {
      throw new NotFoundError('Contract', params.contractId)
    }

    return this.getContractDetailAfterMutation({
      tenantId: params.tenantId,
      contractId: params.contractId,
      employeeId: params.actorEmployeeId,
      role: params.actorRole,
      updatedContract: contract,
    })
  }

  async manageLegalAssignment(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole?: string
    actorEmail: string
    operation: ContractLegalAssignmentOperation
    ownerEmail?: string
    collaboratorEmail?: string
  }): Promise<ContractDetailView> {
    if (!params.actorRole) {
      throw new AuthorizationError('CONTRACT_ASSIGNMENT_FORBIDDEN', 'User role is required for legal assignment')
    }

    if (!params.actorEmail) {
      throw new BusinessRuleError('ACTOR_EMAIL_REQUIRED', 'Actor email is required')
    }

    if (params.operation === 'set_owner') {
      if (!params.ownerEmail) {
        throw new BusinessRuleError('OWNER_EMAIL_REQUIRED', 'Owner email is required')
      }

      await this.contractRepository.setLegalOwnerByEmail({
        tenantId: params.tenantId,
        contractId: params.contractId,
        actorEmployeeId: params.actorEmployeeId,
        actorRole: params.actorRole,
        actorEmail: params.actorEmail,
        ownerEmail: params.ownerEmail,
      })
    }

    if (params.operation === 'add_collaborator') {
      if (!params.collaboratorEmail) {
        throw new BusinessRuleError('COLLABORATOR_EMAIL_REQUIRED', 'Collaborator email is required')
      }

      await this.contractRepository.addLegalCollaboratorByEmail({
        tenantId: params.tenantId,
        contractId: params.contractId,
        actorEmployeeId: params.actorEmployeeId,
        actorRole: params.actorRole,
        actorEmail: params.actorEmail,
        collaboratorEmail: params.collaboratorEmail,
      })
    }

    if (params.operation === 'remove_collaborator') {
      if (!params.collaboratorEmail) {
        throw new BusinessRuleError('COLLABORATOR_EMAIL_REQUIRED', 'Collaborator email is required')
      }

      await this.contractRepository.removeLegalCollaboratorByEmail({
        tenantId: params.tenantId,
        contractId: params.contractId,
        actorEmployeeId: params.actorEmployeeId,
        actorRole: params.actorRole,
        actorEmail: params.actorEmail,
        collaboratorEmail: params.collaboratorEmail,
      })
    }

    const contract = await this.contractRepository.getById(params.tenantId, params.contractId)

    if (!contract) {
      throw new NotFoundError('Contract', params.contractId)
    }

    return this.getContractDetailAfterMutation({
      tenantId: params.tenantId,
      contractId: params.contractId,
      employeeId: params.actorEmployeeId,
      role: params.actorRole,
      updatedContract: contract,
    })
  }

  private async getContractDetailAfterMutation(params: {
    tenantId: string
    contractId: string
    employeeId: string
    role?: string
    updatedContract: ContractDetail
  }): Promise<ContractDetailView> {
    try {
      return await this.getContractDetail({
        tenantId: params.tenantId,
        contractId: params.contractId,
        employeeId: params.employeeId,
        role: params.role,
      })
    } catch (error) {
      if (error instanceof AuthorizationError && error.code === 'CONTRACT_READ_FORBIDDEN') {
        return {
          contract: params.updatedContract,
          counterparties: [],
          documents: [],
          availableActions: [],
          additionalApprovers: [],
          legalCollaborators: [],
        }
      }

      throw error
    }
  }
}
