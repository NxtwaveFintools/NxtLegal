import type { ContractSignatoryStatus, ContractStatus } from '@/core/constants/contracts'
import type { ContractActionName } from '@/core/domain/contracts/schemas'

export type ContractListItem = {
  id: string
  title: string
  status: ContractStatus
  displayStatusLabel?: string
  uploadedByEmployeeId: string
  uploadedByEmail: string
  currentAssigneeEmployeeId: string
  currentAssigneeEmail: string
  latestAdditionalApproverRejectionReason?: string | null
  latestAdditionalApproverRejectionAt?: string | null
  isAdditionalApproverActionable?: boolean
  hodApprovedAt?: string | null
  tatDeadlineAt?: string | null
  tatBreachedAt?: string | null
  agingBusinessDays?: number | null
  nearBreach?: boolean
  isTatBreached?: boolean
  isAssignedToMe?: boolean
  hasUnreadActivity?: boolean
  canHodApprove?: boolean
  canHodReject?: boolean
  createdAt: string
  updatedAt: string
}

export type DashboardContractFilter = 'ALL' | 'HOD_PENDING' | 'LEGAL_PENDING' | 'FINAL_APPROVED' | 'LEGAL_QUERY'

export type RepositorySortBy = 'title' | 'created_at' | 'hod_approved_at' | 'status' | 'tat_deadline_at'
export type RepositorySortDirection = 'asc' | 'desc'

export type ContractDetail = ContractListItem & {
  contractTypeId: string
  contractTypeName?: string
  counterpartyName?: string | null
  departmentId: string
  departmentName?: string
  departmentHodName?: string | null
  departmentHodEmail?: string | null
  signatoryName: string
  signatoryDesignation: string
  signatoryEmail: string
  backgroundOfRequest: string
  budgetApproved: boolean
  requestCreatedAt: string
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
  filePath: string
  rowVersion: number
}

export type ContractCounterparty = {
  id: string
  counterpartyName: string
  sequenceOrder: number
}

export type ContractDocument = {
  id: string
  documentKind: 'PRIMARY' | 'COUNTERPARTY_SUPPORTING'
  counterpartyId?: string | null
  counterpartyName?: string | null
  displayName: string
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
  createdAt: string
}

export type ContractTimelineEvent = {
  id: string
  eventType: string | null
  action: string
  userId: string
  actorEmail?: string | null
  actorRole?: string | null
  targetEmail?: string | null
  noteText?: string | null
  metadata?: Record<string, unknown> | null
  eventSequence?: number | null
  createdAt: string
}

export type ContractActivityReadState = {
  contractId: string
  employeeId: string
  lastSeenEventSequence: number | null
  lastSeenAt: string | null
  hasUnread: boolean
}

export type ContractAllowedAction = {
  action: ContractActionName
  label: string
  requiresRemark: boolean
}

export type ContractAdditionalApprover = {
  id: string
  approverEmployeeId: string
  approverEmail: string
  sequenceOrder: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  approvedAt: string | null
}

export type ContractLegalCollaborator = {
  id: string
  collaboratorEmployeeId: string
  collaboratorEmail: string
  createdAt: string
}

export type ContractSignatory = {
  id: string
  signatoryEmail: string
  status: ContractSignatoryStatus
  signedAt: string | null
  docusignEnvelopeId: string
  docusignRecipientId: string
  createdAt: string
}

export type ContractDetailView = {
  contract: ContractDetail
  counterparties: ContractCounterparty[]
  documents: ContractDocument[]
  availableActions: ContractAllowedAction[]
  additionalApprovers: ContractAdditionalApprover[]
  legalCollaborators: ContractLegalCollaborator[]
  signatories: ContractSignatory[]
}

export type AdditionalApproverDecisionHistoryItem = {
  contractId: string
  contractTitle: string
  contractStatus: ContractStatus
  contractDisplayStatusLabel: string
  departmentId: string | null
  departmentName: string | null
  actorEmail: string | null
  decision: 'APPROVED' | 'REJECTED'
  decidedAt: string
  reason: string | null
}

export interface ContractQueryRepository {
  listByTenant(params: {
    tenantId: string
    cursor?: string
    limit: number
    role?: string
    employeeId: string
  }): Promise<{ items: ContractListItem[]; nextCursor?: string; total: number }>
  getPendingApprovalsForRole(params: {
    tenantId: string
    employeeId: string
    role?: string
    limit: number
  }): Promise<ContractListItem[]>
  getDashboardContracts(params: {
    tenantId: string
    employeeId: string
    role?: string
    filter: DashboardContractFilter
    cursor?: string
    limit: number
  }): Promise<{ items: ContractListItem[]; nextCursor?: string; total: number }>
  getActionableAdditionalApprovals(params: {
    tenantId: string
    employeeId: string
    limit: number
  }): Promise<ContractListItem[]>
  getAdditionalApproverDecisionHistory(params: {
    tenantId: string
    employeeId: string
    role?: string
    cursor?: string
    limit: number
    departmentId?: string
  }): Promise<{ items: AdditionalApproverDecisionHistoryItem[]; nextCursor?: string; total: number }>
  listRepositoryContracts(params: {
    tenantId: string
    employeeId: string
    role?: string
    cursor?: string
    limit: number
    search?: string
    status?: ContractStatus
    sortBy?: RepositorySortBy
    sortDirection?: RepositorySortDirection
  }): Promise<{ items: ContractListItem[]; nextCursor?: string; total: number }>
  getById(tenantId: string, contractId: string): Promise<ContractDetail | null>
  getCounterparties(tenantId: string, contractId: string): Promise<ContractCounterparty[]>
  getDocuments(tenantId: string, contractId: string): Promise<ContractDocument[]>
  getTimeline(tenantId: string, contractId: string, limit: number): Promise<ContractTimelineEvent[]>
  getAdditionalApprovers(tenantId: string, contractId: string): Promise<ContractAdditionalApprover[]>
  getLegalCollaborators(tenantId: string, contractId: string): Promise<ContractLegalCollaborator[]>
  isLegalCollaborator(tenantId: string, contractId: string, employeeId: string): Promise<boolean>
  getSignatories(tenantId: string, contractId: string): Promise<ContractSignatory[]>
  canAccessContract(params: {
    tenantId: string
    actorEmployeeId: string
    actorRole?: string
    contract: ContractDetail
  }): Promise<boolean>
  getAvailableActions(params: {
    tenantId: string
    contract: ContractDetail
    actorEmployeeId: string
    actorRole?: string
  }): Promise<ContractAllowedAction[]>
  applyAction(params: {
    tenantId: string
    contractId: string
    action: ContractActionName
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    noteText?: string
  }): Promise<ContractDetail>
  addAdditionalApprover(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    approverEmail: string
  }): Promise<void>
  setLegalOwnerByEmail(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    ownerEmail: string
  }): Promise<void>
  addLegalCollaboratorByEmail(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    collaboratorEmail: string
  }): Promise<void>
  removeLegalCollaboratorByEmail(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    collaboratorEmail: string
  }): Promise<void>
  addSignatory(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    signatoryEmail: string
    docusignEnvelopeId: string
    docusignRecipientId: string
  }): Promise<void>
  markSignatoryAsSigned(params: {
    tenantId: string
    envelopeId: string
    recipientEmail?: string
    signedAt?: string
  }): Promise<void>
  addContractNote(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    noteText: string
  }): Promise<void>
  addContractActivityMessage(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    messageText: string
  }): Promise<void>
  markContractActivitySeen(params: {
    tenantId: string
    contractId: string
    employeeId: string
  }): Promise<ContractActivityReadState>
}
