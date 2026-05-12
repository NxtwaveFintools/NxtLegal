import { routeRegistry } from '@/core/config/route-registry'
import type { ApiResponse } from '@/core/http/response'
import type { ContractUploadMode } from '@/core/constants/contracts'
import { envPublic } from '@/core/config/env.public'

type ContractActionName =
  | 'hod.approve'
  | 'hod.reject'
  | 'hod.bypass'
  | 'legal.set.under_review'
  | 'legal.set.pending_internal'
  | 'legal.set.pending_external'
  | 'legal.set.offline_execution'
  | 'legal.set.on_hold'
  | 'legal.set.completed'
  | 'legal.void'
  | 'legal.approve'
  | 'legal.reject'
  | 'legal.query'
  | 'legal.query.reroute'
  | 'approver.approve'
  | 'approver.reject'

type ContractSkipApprovalActionName = 'BYPASS_APPROVAL'

type ContractRecord = {
  id: string
  title: string
  voidReason?: string | null
  creatorName?: string | null
  contractTypeId?: string
  contractTypeName?: string
  counterpartyName?: string | null
  counterparties?: Array<{
    id: string
    counterpartyName: string
    sequenceOrder: number
  }>
  status: string
  displayStatusLabel?: string
  repositoryStatus?: string
  repositoryStatusLabel?: string
  uploadedByEmployeeId: string
  uploadedByEmail: string
  currentAssigneeEmployeeId: string
  currentAssigneeEmail: string
  latestAdditionalApproverRejectionReason?: string | null
  latestAdditionalApproverRejectionAt?: string | null
  isAdditionalApproverActionable?: boolean
  hodApprovedAt?: string | null
  departmentId?: string
  departmentName?: string
  uploadMode?: ContractUploadMode
  departmentHodName?: string | null
  departmentHodEmail?: string | null
  assignedToUsers?: string[]
  signatoryName?: string
  signatoryDesignation?: string
  signatoryEmail?: string
  backgroundOfRequest?: string
  budgetApproved?: boolean
  legalEffectiveDate?: string | null
  legalTerminationDate?: string | null
  legalNoticePeriod?: string | null
  legalAutoRenewal?: boolean | null
  requestCreatedAt?: string
  executedAt?: string | null
  currentDocumentId?: string | null
  tatDeadlineAt?: string | null
  tatBreachedAt?: string | null
  agingBusinessDays?: number | null
  nearBreach?: boolean
  isTatBreached?: boolean
  isAssignedToMe?: boolean
  hasUnreadActivity?: boolean
  canHodApprove?: boolean
  canHodReject?: boolean
  fileName?: string
  fileSizeBytes?: number
  fileMimeType?: string
  createdAt: string
  updatedAt: string
}

type ContractDocument = {
  id: string
  documentKind: 'PRIMARY' | 'COUNTERPARTY_SUPPORTING' | 'EXECUTED_CONTRACT' | 'AUDIT_CERTIFICATE'
  versionNumber?: number
  counterpartyId?: string | null
  counterpartyName?: string | null
  displayName: string
  fileName: string
  fileSizeBytes: number
  fileMimeType: string
  createdAt: string
}

type DashboardContractsFilter =
  | 'ALL'
  | 'HOD_PENDING'
  | 'UNDER_REVIEW'
  | 'COMPLETED'
  | 'ON_HOLD'
  | 'REJECTED'
  | 'ASSIGNED_TO_ME'
type DashboardContractsScope = 'default' | 'personal'

type RepositorySortBy = 'title' | 'created_at' | 'hod_approved_at' | 'status' | 'tat_deadline_at'
type RepositorySortDirection = 'asc' | 'desc'
type RepositoryDateBasis = 'request_created_at' | 'hod_approved_at'
type RepositoryDatePreset = 'week' | 'month' | 'multiple_months' | 'quarter' | 'year' | 'custom'
type RepositoryStatusFilter =
  | 'HOD_APPROVAL_PENDING'
  | 'UNDER_REVIEW'
  | 'OFFLINE_EXECUTION'
  | 'PENDING_WITH_EXTERNAL_STAKEHOLDERS'
  | 'PENDING_WITH_INTERNAL_STAKEHOLDERS'
  | 'SIGNING'
  | 'ON_HOLD'
  | 'REJECTED'
  | 'COMPLETED'
  | 'EXECUTED'
type RepositoryExportFormat = 'csv' | 'excel' | 'pdf'
type RepositoryExportColumn =
  | 'request_date'
  | 'creator'
  | 'department'
  | 'hod_approval'
  | 'approval_date'
  | 'tat'
  | 'contract_aging'
  | 'status'
  | 'assigned_to'
  | 'effective_date'
  | 'termination_date'
  | 'notice_period'
  | 'auto_renewal'
  | 'tat_breached'
  | 'overdue_days'
  | 'contract_title'

type RepositoryDepartmentMetric = {
  departmentId: string | null
  departmentName: string | null
  totalRequestsReceived: number
  approved: number
  rejected: number
  completed: number
  pending: number
}

type RepositoryStatusMetric = {
  key:
    | 'executed'
    | 'completed'
    | 'signing'
    | 'under_review'
    | 'pending_internal'
    | 'pending_external'
    | 'hod_approval_pending'
    | 'tat_breached'
  label: string
  count: number
}

type RepositoryReportResponse = {
  report: {
    departmentMetrics: RepositoryDepartmentMetric[]
    statusMetrics: RepositoryStatusMetric[]
  }
}

type ContractTimelineEvent = {
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

type ContractActivityReadState = {
  contractId: string
  employeeId: string
  lastSeenEventSequence: number | null
  lastSeenAt: string | null
  hasUnread: boolean
}

type ContractAllowedAction = {
  action: ContractActionName
  label: string
  requiresRemark: boolean
}

type ContractAdditionalApprover = {
  id: string
  approverEmployeeId: string
  approverEmail: string
  sequenceOrder: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'BYPASSED'
  approvedAt: string | null
  noteText?: string | null
}

type ContractApproverReminderResponse = {
  remindedApproverEmail: string
  remindedApproverRole: 'HOD' | 'ADDITIONAL'
}

type ContractLegalCollaborator = {
  id: string
  collaboratorEmployeeId: string
  collaboratorEmail: string
  createdAt: string
}

type ContractSignatory = {
  id: string
  signatoryEmail: string
  recipientType: 'INTERNAL' | 'EXTERNAL'
  routingOrder: number
  fieldConfig: Array<{
    fieldType: 'SIGNATURE' | 'INITIAL' | 'STAMP' | 'NAME' | 'DATE' | 'TIME' | 'TEXT'
    pageNumber: number | null
    xPosition: number | null
    yPosition: number | null
    width?: number | null
    height?: number | null
    anchorString: string | null
    assignedSignerEmail: string
  }>
  status: 'PENDING' | 'SIGNED'
  signedAt: string | null
  zohoSignEnvelopeId: string
  zohoSignRecipientId: string
  createdAt: string
}

type FinalSigningArtifactType = 'signed_document' | 'completion_certificate' | 'merged_pdf'

type ContractSigningPreparationDraft = {
  contractId: string
  recipients: Array<{
    name: string
    email: string
    recipientType: 'INTERNAL' | 'EXTERNAL'
    routingOrder: number
    designation?: string
    counterpartyId?: string
    counterpartyName?: string
    backgroundOfRequest?: string
    budgetApproved?: boolean
  }>
  fields: Array<{
    fieldType: 'SIGNATURE' | 'INITIAL' | 'STAMP' | 'NAME' | 'DATE' | 'TIME' | 'TEXT'
    pageNumber: number | null
    xPosition: number | null
    yPosition: number | null
    width?: number | null
    height?: number | null
    anchorString: string | null
    assignedSignerEmail: string
  }>
  createdByEmployeeId: string
  updatedByEmployeeId: string
  createdAt: string
  updatedAt: string
}

type ContractDetailResponse = {
  contract: ContractRecord
  counterparties: Array<{
    id: string
    counterpartyName: string
    sequenceOrder: number
  }>
  documents: ContractDocument[]
  availableActions: ContractAllowedAction[]
  additionalApprovers: ContractAdditionalApprover[]
  legalCollaborators: ContractLegalCollaborator[]
  signatories: ContractSignatory[]
}

type LegalAssignmentPayload =
  | { operation: 'add_collaborator'; collaboratorEmail: string }
  | { operation: 'remove_collaborator'; collaboratorEmail: string }

type LegalMetadataPayload = {
  effectiveDate: string | null
  terminationDate: string | null
  noticePeriod: string | null
  autoRenewal: boolean | null
}

type ContractListResponse = {
  contracts: ContractRecord[]
  pagination: {
    cursor: string | null
    limit: number
    total: number
  }
}

type DashboardContractsResponse = ContractListResponse & {
  filter: DashboardContractsFilter
  additionalApproverSections?: {
    actionableContracts: ContractRecord[]
  }
}

type DashboardCountsResponse = {
  counts: Partial<Record<DashboardContractsFilter, number>>
}

type RepositoryListResponse = ContractListResponse & {
  /** Present only when includeReport=true was requested. */
  report?: RepositoryReportResponse['report']
}

type AdditionalApproverDecisionHistoryRecord = {
  contractId: string
  contractTitle: string
  contractStatus: string
  contractDisplayStatusLabel: string
  departmentId: string | null
  departmentName: string | null
  actorEmail: string | null
  decision: 'APPROVED' | 'REJECTED'
  decidedAt: string
  reason: string | null
}

type AdditionalApproverHistoryResponse = {
  history: AdditionalApproverDecisionHistoryRecord[]
  pagination: {
    cursor: string | null
    limit: number
    total: number
  }
}

type DepartmentOption = {
  id: string
  name: string
  hodName?: string | null
  hodEmail?: string | null
}

type ContractTypeOption = {
  id: string
  name: string
}

type CounterpartyOption = {
  name: string
  backgroundOfRequest?: string
  budgetApproved?: boolean
  signatories?: Array<{
    name: string
    designation: string
    email: string
  }>
}

type LegalTeamMemberOption = {
  id: string
  email: string
  fullName?: string | null
}

/** User-friendly message returned when `fetch()` itself throws (network down, DNS failure, CORS). */
const NETWORK_ERROR_MESSAGE = 'Network error. Please check your connection and try again.'

function networkErrorResponse<T>(): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: 'network_error',
      message: NETWORK_ERROR_MESSAGE,
    },
  }
}

async function parseApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    return (await response.json()) as ApiResponse<T>
  } catch {
    return {
      ok: false,
      error: {
        code: 'invalid_json_response',
        message: 'Unexpected response from server',
      },
    }
  }
}

/**
 * Wraps `fetch()` + `parseApiResponse()` in a single call that gracefully
 * catches network-level errors (e.g. `TypeError: Failed to fetch` when
 * offline) and returns a well-formed `ApiResponse<T>` instead of throwing.
 *
 * Every non-GET mutation method in `contractsClient` should use this instead
 * of bare `fetch()` to ensure the UI never sees a raw TypeError.
 */
async function safeFetch<T>(url: string, init?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, init)
    return parseApiResponse<T>(response)
  } catch {
    return networkErrorResponse<T>()
  }
}

function resolveSupabaseSignedUploadUrl(signedUrl: string): string {
  if (/^https?:\/\//i.test(signedUrl)) {
    return signedUrl
  }

  const baseUrl = envPublic.supabaseUrl.replace(/\/+$/, '')
  if (signedUrl.startsWith('/')) {
    return `${baseUrl}${signedUrl}`
  }

  return `${baseUrl}/${signedUrl}`
}

function xhrSignedUpload(
  signedUrl: string,
  file: File,
  options?: {
    signal?: AbortSignal
    onProgress?: (loadedBytes: number) => void
  }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', resolveSupabaseSignedUploadUrl(signedUrl))

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && options?.onProgress) {
        options.onProgress(event.loaded)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }

      reject(new Error(`Signed upload failed with status ${xhr.status}`))
    })

    xhr.addEventListener('error', () => reject(new Error('Signed upload failed due to a network error')))
    xhr.addEventListener('abort', () => reject(new Error('Signed upload was cancelled')))

    if (options?.signal) {
      if (options.signal.aborted) {
        reject(new Error('Signed upload was cancelled'))
        return
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.send(file)
  })
}

/**
 * In-flight GET request deduplication map.
 *
 * Caches the *parsed JSON result* (not the raw Response) so that concurrent
 * callers — e.g. from React Strict Mode's intentional double-mount — all
 * receive the same deserialized object.  Storing the raw Response would cause
 * a "body already consumed" error because a Response body stream can only be
 * read once.  The entry is removed once the request settles so that a later,
 * independent call always gets a fresh response.
 */
const inflightGetCache = new Map<string, Promise<ApiResponse<unknown>>>()

function fetchGetJson<T>(url: string): Promise<ApiResponse<T>> {
  const cached = inflightGetCache.get(url)
  if (cached) return cached as Promise<ApiResponse<T>>

  const promise: Promise<ApiResponse<unknown>> = fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })
    .then((res) => res.json() as Promise<ApiResponse<unknown>>)
    .catch(() => networkErrorResponse<unknown>())
    .finally(() => {
      inflightGetCache.delete(url)
    })

  inflightGetCache.set(url, promise)
  return promise as Promise<ApiResponse<T>>
}

function resolveContractPath(template: string, contractId: string): string {
  return template.replace(':contractId', contractId)
}

function resolveProtectedContractPath(
  contractId: string,
  options?: {
    from?: 'dashboard' | 'repository'
    filter?: DashboardContractsFilter
  }
): string {
  const basePath = routeRegistry.protected.contractDetail.replace(':contractId', contractId)
  const query = new URLSearchParams()

  if (options?.from) {
    query.set('from', options.from)
  }

  if (options?.filter) {
    query.set('filter', options.filter)
  }

  if (query.size === 0) {
    return basePath
  }

  return `${basePath}?${query.toString()}`
}

export const contractsClient = {
  async contractTypes(): Promise<ApiResponse<{ contractTypes: ContractTypeOption[] }>> {
    return fetchGetJson<{ contractTypes: ContractTypeOption[] }>(routeRegistry.api.contracts.contractTypes)
  },

  async counterparties(): Promise<ApiResponse<{ counterparties: CounterpartyOption[] }>> {
    return fetchGetJson<{ counterparties: CounterpartyOption[] }>(routeRegistry.api.contracts.counterparties)
  },

  async departments(): Promise<ApiResponse<{ departments: DepartmentOption[] }>> {
    return fetchGetJson<{ departments: DepartmentOption[] }>(routeRegistry.api.contracts.departments)
  },

  async legalTeamMembers(): Promise<ApiResponse<{ members: LegalTeamMemberOption[] }>> {
    return fetchGetJson<{ members: LegalTeamMemberOption[] }>(routeRegistry.api.contracts.legalTeamMembers)
  },

  async list(params?: { cursor?: string; limit?: number }): Promise<ApiResponse<ContractListResponse>> {
    const query = new URLSearchParams()

    if (params?.cursor) {
      query.set('cursor', params.cursor)
    }

    if (params?.limit) {
      query.set('limit', String(params.limit))
    }

    const url =
      query.size > 0 ? `${routeRegistry.api.contracts.list}?${query.toString()}` : routeRegistry.api.contracts.list
    return fetchGetJson<ContractListResponse>(url)
  },

  async pendingApprovals(params?: { limit?: number }): Promise<ApiResponse<ContractListResponse>> {
    const query = new URLSearchParams()

    if (params?.limit) {
      query.set('limit', String(params.limit))
    }

    const url =
      query.size > 0
        ? `${routeRegistry.api.contracts.pendingApprovals}?${query.toString()}`
        : routeRegistry.api.contracts.pendingApprovals

    return fetchGetJson<ContractListResponse>(url)
  },

  async dashboardContracts(params: {
    filter: DashboardContractsFilter
    scope?: DashboardContractsScope
    cursor?: string
    limit?: number
    includeExtras?: boolean
  }): Promise<ApiResponse<DashboardContractsResponse>> {
    const query = new URLSearchParams()
    query.set('filter', params.filter)

    if (params.scope) {
      query.set('scope', params.scope)
    }

    if (params.cursor) {
      query.set('cursor', params.cursor)
    }

    if (params.limit) {
      query.set('limit', String(params.limit))
    }

    if (typeof params.includeExtras === 'boolean') {
      query.set('includeExtras', String(params.includeExtras))
    }

    return fetchGetJson<DashboardContractsResponse>(`${routeRegistry.api.contracts.dashboard}?${query.toString()}`)
  },

  async dashboardCounts(params: {
    filters: DashboardContractsFilter[]
  }): Promise<ApiResponse<DashboardCountsResponse>> {
    const query = new URLSearchParams()
    query.set('filters', params.filters.join(','))

    return fetchGetJson<DashboardCountsResponse>(`${routeRegistry.api.contracts.dashboardCounts}?${query.toString()}`)
  },

  async additionalApproverHistory(params?: {
    cursor?: string
    limit?: number
    departmentId?: string
  }): Promise<ApiResponse<AdditionalApproverHistoryResponse>> {
    const query = new URLSearchParams()

    if (params?.cursor) {
      query.set('cursor', params.cursor)
    }

    if (params?.limit) {
      query.set('limit', String(params.limit))
    }

    if (params?.departmentId) {
      query.set('departmentId', params.departmentId)
    }

    const url =
      query.size > 0
        ? `${routeRegistry.api.contracts.additionalApproverHistory}?${query.toString()}`
        : routeRegistry.api.contracts.additionalApproverHistory

    return fetchGetJson<AdditionalApproverHistoryResponse>(url)
  },

  async repositoryList(params?: {
    cursor?: string
    limit?: number
    search?: string
    status?: string
    repositoryStatus?: RepositoryStatusFilter
    sortBy?: RepositorySortBy
    sortDirection?: RepositorySortDirection
    dateBasis?: RepositoryDateBasis
    datePreset?: RepositoryDatePreset
    fromDate?: string
    toDate?: string
    /** When true, the response will include reporting aggregates; avoids a separate repositoryReport call. */
    includeReport?: boolean
  }): Promise<ApiResponse<RepositoryListResponse>> {
    const query = new URLSearchParams()

    if (params?.cursor) {
      query.set('cursor', params.cursor)
    }

    if (params?.limit) {
      query.set('limit', String(params.limit))
    }

    if (params?.search?.trim()) {
      query.set('search', params.search.trim())
    }

    if (params?.status) {
      query.set('status', params.status)
    }

    if (params?.repositoryStatus) {
      query.set('repositoryStatus', params.repositoryStatus)
    }

    if (params?.sortBy) {
      query.set('sortBy', params.sortBy)
    }

    if (params?.sortDirection) {
      query.set('sortDirection', params.sortDirection)
    }

    if (params?.dateBasis) {
      query.set('dateBasis', params.dateBasis)
    }

    if (params?.datePreset) {
      query.set('datePreset', params.datePreset)
    }

    if (params?.fromDate) {
      query.set('fromDate', params.fromDate)
    }

    if (params?.toDate) {
      query.set('toDate', params.toDate)
    }

    if (params?.includeReport) {
      query.set('includeReport', 'true')
    }

    const url =
      query.size > 0
        ? `${routeRegistry.api.contracts.repository}?${query.toString()}`
        : routeRegistry.api.contracts.repository

    return fetchGetJson<RepositoryListResponse>(url)
  },

  async repositoryReport(params?: {
    search?: string
    status?: string
    repositoryStatus?: RepositoryStatusFilter
    dateBasis?: RepositoryDateBasis
    datePreset?: RepositoryDatePreset
    fromDate?: string
    toDate?: string
  }): Promise<ApiResponse<RepositoryReportResponse>> {
    const query = new URLSearchParams()

    if (params?.search?.trim()) {
      query.set('search', params.search.trim())
    }

    if (params?.status) {
      query.set('status', params.status)
    }

    if (params?.repositoryStatus) {
      query.set('repositoryStatus', params.repositoryStatus)
    }

    if (params?.dateBasis) {
      query.set('dateBasis', params.dateBasis)
    }

    if (params?.datePreset) {
      query.set('datePreset', params.datePreset)
    }

    if (params?.fromDate) {
      query.set('fromDate', params.fromDate)
    }

    if (params?.toDate) {
      query.set('toDate', params.toDate)
    }

    const url =
      query.size > 0
        ? `${routeRegistry.api.contracts.repositoryReport}?${query.toString()}`
        : routeRegistry.api.contracts.repositoryReport

    return fetchGetJson<RepositoryReportResponse>(url)
  },

  repositoryExportUrl(params?: {
    search?: string
    status?: string
    repositoryStatus?: RepositoryStatusFilter
    dateBasis?: RepositoryDateBasis
    datePreset?: RepositoryDatePreset
    fromDate?: string
    toDate?: string
    format?: RepositoryExportFormat
    columns?: RepositoryExportColumn[]
  }): string {
    const query = new URLSearchParams()

    if (params?.search?.trim()) {
      query.set('search', params.search.trim())
    }

    if (params?.status) {
      query.set('status', params.status)
    }

    if (params?.repositoryStatus) {
      query.set('repositoryStatus', params.repositoryStatus)
    }

    if (params?.dateBasis) {
      query.set('dateBasis', params.dateBasis)
    }

    if (params?.datePreset) {
      query.set('datePreset', params.datePreset)
    }

    if (params?.fromDate) {
      query.set('fromDate', params.fromDate)
    }

    if (params?.toDate) {
      query.set('toDate', params.toDate)
    }

    if (params?.format) {
      query.set('format', params.format)
    }

    if (params?.columns?.length) {
      query.set('columns', params.columns.join(','))
    }

    return query.size > 0
      ? `${routeRegistry.api.contracts.repositoryExport}?${query.toString()}`
      : routeRegistry.api.contracts.repositoryExport
  },

  async detail(contractId: string): Promise<ApiResponse<ContractDetailResponse>> {
    return fetchGetJson<ContractDetailResponse>(resolveContractPath(routeRegistry.api.contracts.detail, contractId))
  },

  async timeline(contractId: string): Promise<ApiResponse<{ events: ContractTimelineEvent[] }>> {
    return fetchGetJson<{ events: ContractTimelineEvent[] }>(
      `${resolveContractPath(routeRegistry.api.contracts.timeline, contractId)}?limit=20`
    )
  },

  async addActivityMessage(contractId: string, payload: { messageText: string }) {
    return safeFetch<ContractDetailResponse>(resolveContractPath(routeRegistry.api.contracts.activity, contractId), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  },

  async markActivitySeen(contractId: string) {
    return safeFetch<ContractActivityReadState>(
      resolveContractPath(routeRegistry.api.contracts.activityReadState, contractId),
      {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ markSeen: true }),
      }
    )
  },

  async upload(params: {
    title: string
    contractTypeId: string
    counterpartyName?: string
    counterparties?: Array<{
      counterpartyName: string
      supportingFiles: File[]
      backgroundOfRequest?: string
      budgetApproved?: boolean
      signatories?: Array<{
        name: string
        designation: string
        email: string
      }>
    }>
    signatoryName?: string
    signatoryDesignation?: string
    signatoryEmail?: string
    backgroundOfRequest?: string
    departmentId?: string
    budgetApproved?: boolean
    uploadMode?: ContractUploadMode
    bypassHodApproval?: boolean
    bypassReason?: string
    file: File
    supportingFiles?: File[]
    idempotencyKey: string
    /** Callback invoked with 0–100 as bytes are uploaded */
    onProgress?: (percent: number) => void
    /** AbortSignal to cancel the upload mid-flight */
    signal?: AbortSignal
  }): Promise<ApiResponse<{ contract: ContractRecord }>> {
    const initPayload = {
      title: params.title,
      contractTypeId: params.contractTypeId,
      signatoryName: params.signatoryName,
      signatoryDesignation: params.signatoryDesignation,
      signatoryEmail: params.signatoryEmail,
      backgroundOfRequest: params.backgroundOfRequest,
      departmentId: params.departmentId,
      budgetApproved: params.budgetApproved,
      uploadMode: params.uploadMode,
      bypassHodApproval: params.bypassHodApproval,
      bypassReason: params.bypassReason,
      counterpartyName: params.counterpartyName,
      file: {
        fileName: params.file.name,
        fileSizeBytes: params.file.size,
        fileMimeType: params.file.type || 'application/octet-stream',
      },
      counterparties:
        params.counterparties?.map((counterparty) => ({
          counterpartyName: counterparty.counterpartyName,
          backgroundOfRequest: counterparty.backgroundOfRequest,
          budgetApproved: counterparty.budgetApproved,
          signatories: counterparty.signatories ?? [],
          supportingFiles: counterparty.supportingFiles.map((file) => ({
            fileName: file.name,
            fileSizeBytes: file.size,
            fileMimeType: file.type || 'application/octet-stream',
          })),
        })) ?? [],
      supportingFiles: (params.supportingFiles ?? []).map((file) => ({
        fileName: file.name,
        fileSizeBytes: file.size,
        fileMimeType: file.type || 'application/octet-stream',
      })),
    }

    const initResponse = await safeFetch<{
      contractId: string
      primaryUpload: { signedUrl: string }
      counterpartySupportingUploads: Array<{ counterpartyIndex: number; supportingIndex: number; signedUrl: string }>
      commonSupportingUploads: Array<{ supportingIndex: number; signedUrl: string }>
    }>(routeRegistry.api.contracts.uploadInit, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `${params.idempotencyKey}:init`,
      },
      body: JSON.stringify(initPayload),
      signal: params.signal,
    })

    if (!initResponse.ok || !initResponse.data) {
      return initResponse as unknown as ApiResponse<{ contract: ContractRecord }>
    }

    const allFiles = [
      params.file,
      ...(params.counterparties ?? []).flatMap((counterparty) => counterparty.supportingFiles),
      ...(params.supportingFiles ?? []),
    ]
    const totalBytes = Math.max(
      allFiles.reduce((sum, file) => sum + Math.max(file.size, 0), 0),
      1
    )
    let uploadedCommittedBytes = 0

    const emitAggregatedProgress = (currentFileSize: number, currentFileLoaded: number): void => {
      if (!params.onProgress) {
        return
      }

      const boundedLoaded = Math.min(Math.max(currentFileLoaded, 0), currentFileSize)
      const overallLoaded = Math.min(uploadedCommittedBytes + boundedLoaded, totalBytes)
      params.onProgress(Math.round((overallLoaded / totalBytes) * 100))
    }

    try {
      emitAggregatedProgress(1, 0)
      await xhrSignedUpload(initResponse.data.primaryUpload.signedUrl, params.file, {
        signal: params.signal,
        onProgress: (loadedBytes) => emitAggregatedProgress(params.file.size, loadedBytes),
      })
      uploadedCommittedBytes += params.file.size

      for (const plannedUpload of initResponse.data.counterpartySupportingUploads) {
        const file =
          params.counterparties?.[plannedUpload.counterpartyIndex]?.supportingFiles?.[plannedUpload.supportingIndex]
        if (!file) {
          return {
            ok: false,
            error: {
              code: 'upload_mapping_invalid',
              message: 'Counterparty supporting upload mapping failed.',
            },
          }
        }

        await xhrSignedUpload(plannedUpload.signedUrl, file, {
          signal: params.signal,
          onProgress: (loadedBytes) => emitAggregatedProgress(file.size, loadedBytes),
        })
        uploadedCommittedBytes += file.size
      }

      for (const plannedUpload of initResponse.data.commonSupportingUploads) {
        const file = params.supportingFiles?.[plannedUpload.supportingIndex]
        if (!file) {
          return {
            ok: false,
            error: {
              code: 'upload_mapping_invalid',
              message: 'Common supporting upload mapping failed.',
            },
          }
        }

        await xhrSignedUpload(plannedUpload.signedUrl, file, {
          signal: params.signal,
          onProgress: (loadedBytes) => emitAggregatedProgress(file.size, loadedBytes),
        })
        uploadedCommittedBytes += file.size
      }
    } catch (error) {
      if (String(error).toLowerCase().includes('cancel')) {
        return {
          ok: false,
          error: { code: 'upload_cancelled', message: 'Upload was cancelled.' },
        }
      }

      return {
        ok: false,
        error: { code: 'signed_upload_failed', message: 'File upload to storage failed.' },
      }
    }

    params.onProgress?.(100)

    return safeFetch<{ contract: ContractRecord }>(routeRegistry.api.contracts.uploadFinalize, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `${params.idempotencyKey}:finalize`,
      },
      body: JSON.stringify({
        ...initPayload,
        contractId: initResponse.data.contractId,
      }),
      signal: params.signal,
    })
  },

  async replaceMainDocument(params: {
    contractId: string
    file: File
    idempotencyKey: string
    isFinalExecuted?: boolean
  }): Promise<ApiResponse<{ document: ContractDocument }>> {
    const initResponse = await safeFetch<{ upload: { signedUrl: string; path: string; fileName: string } }>(
      resolveContractPath(routeRegistry.api.contracts.replaceMainDocumentInit, params.contractId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${params.idempotencyKey}:init`,
        },
        body: JSON.stringify({
          file: {
            fileName: params.file.name,
            fileSizeBytes: params.file.size,
            fileMimeType: params.file.type || 'application/octet-stream',
          },
          isFinalExecuted: Boolean(params.isFinalExecuted),
        }),
      }
    )

    if (!initResponse.ok || !initResponse.data) {
      return initResponse as unknown as ApiResponse<{ document: ContractDocument }>
    }

    try {
      await xhrSignedUpload(initResponse.data.upload.signedUrl, params.file)
    } catch (error) {
      if (String(error).toLowerCase().includes('cancel')) {
        return {
          ok: false,
          error: { code: 'upload_cancelled', message: 'Upload was cancelled.' },
        }
      }
      return {
        ok: false,
        error: { code: 'signed_upload_failed', message: 'File upload to storage failed.' },
      }
    }

    return safeFetch<{ document: ContractDocument }>(
      resolveContractPath(routeRegistry.api.contracts.replaceMainDocumentFinalize, params.contractId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${params.idempotencyKey}:finalize`,
        },
        body: JSON.stringify({
          file: {
            fileName: initResponse.data.upload.fileName,
            fileSizeBytes: params.file.size,
            fileMimeType: params.file.type || 'application/octet-stream',
            path: initResponse.data.upload.path,
          },
          isFinalExecuted: Boolean(params.isFinalExecuted),
        }),
      }
    )
  },

  async replaceSupportingDocument(params: {
    contractId: string
    documentId: string
    file: File
    idempotencyKey: string
  }): Promise<ApiResponse<{ success: true }>> {
    const initResponse = await safeFetch<{ upload: { signedUrl: string; path: string; fileName: string } }>(
      resolveContractPath(routeRegistry.api.contracts.replaceSupportingDocumentInit, params.contractId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${params.idempotencyKey}:init`,
        },
        body: JSON.stringify({
          documentId: params.documentId,
          file: {
            fileName: params.file.name,
            fileSizeBytes: params.file.size,
            fileMimeType: params.file.type || 'application/octet-stream',
          },
        }),
      }
    )

    if (!initResponse.ok || !initResponse.data) {
      return initResponse as unknown as ApiResponse<{ success: true }>
    }

    try {
      await xhrSignedUpload(initResponse.data.upload.signedUrl, params.file)
    } catch (error) {
      if (String(error).toLowerCase().includes('cancel')) {
        return {
          ok: false,
          error: { code: 'upload_cancelled', message: 'Upload was cancelled.' },
        }
      }
      return {
        ok: false,
        error: { code: 'signed_upload_failed', message: 'File upload to storage failed.' },
      }
    }

    return safeFetch<{ success: true }>(
      resolveContractPath(routeRegistry.api.contracts.replaceSupportingDocumentFinalize, params.contractId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${params.idempotencyKey}:finalize`,
        },
        body: JSON.stringify({
          documentId: params.documentId,
          file: {
            fileName: initResponse.data.upload.fileName,
            fileSizeBytes: params.file.size,
            fileMimeType: params.file.type || 'application/octet-stream',
            path: initResponse.data.upload.path,
          },
        }),
      }
    )
  },

  async action(
    contractId: string,
    payload:
      | { action: ContractActionName; noteText?: string }
      | { action: ContractSkipApprovalActionName; approverId: string; reason: string }
  ) {
    return safeFetch<ContractDetailResponse>(resolveContractPath(routeRegistry.api.contracts.action, contractId), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  },

  async addNote(contractId: string, payload: { noteText: string }) {
    return safeFetch<ContractDetailResponse>(resolveContractPath(routeRegistry.api.contracts.note, contractId), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  },

  async addApprover(contractId: string, payload: { approverEmail: string; noteText?: string }) {
    return safeFetch<ContractDetailResponse>(resolveContractPath(routeRegistry.api.contracts.approvers, contractId), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  },

  async remindApprover(contractId: string, payload?: { approverEmail?: string }) {
    return safeFetch<ContractApproverReminderResponse>(
      resolveContractPath(routeRegistry.api.contracts.approverReminder, contractId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approverEmail: payload?.approverEmail }),
      }
    )
  },

  async manageAssignment(contractId: string, payload: LegalAssignmentPayload) {
    return safeFetch<ContractDetailResponse>(resolveContractPath(routeRegistry.api.contracts.assignments, contractId), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  },

  async updateLegalMetadata(contractId: string, payload: LegalMetadataPayload) {
    return safeFetch<ContractDetailResponse>(
      resolveContractPath(routeRegistry.api.contracts.legalMetadata, contractId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )
  },

  async addSignatory(
    contractId: string,
    payload:
      | { signatoryEmail: string }
      | {
          recipients: Array<{
            signatoryEmail: string
            recipientType: 'INTERNAL' | 'EXTERNAL'
            routingOrder: number
            fields: Array<{
              field_type: 'SIGNATURE' | 'INITIAL' | 'STAMP' | 'NAME' | 'DATE' | 'TIME' | 'TEXT'
              page_number?: number
              x_position?: number
              y_position?: number
              width?: number
              height?: number
              anchor_string?: string
              assigned_signer_email: string
            }>
          }>
        }
  ) {
    return safeFetch<ContractDetailResponse>(resolveContractPath(routeRegistry.api.contracts.signatories, contractId), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  },

  async saveSigningPreparationDraft(
    contractId: string,
    payload: {
      recipients: Array<{
        name: string
        email: string
        recipient_type: 'INTERNAL' | 'EXTERNAL'
        routing_order: number
        designation?: string
        counterparty_id?: string
        counterparty_name?: string
        background_of_request?: string
        budget_approved?: boolean
      }>
      fields: Array<{
        field_type: 'SIGNATURE' | 'INITIAL' | 'STAMP' | 'NAME' | 'DATE' | 'TIME' | 'TEXT'
        page_number?: number
        x_position?: number
        y_position?: number
        width?: number
        height?: number
        anchor_string?: string
        assigned_signer_email: string
      }>
    }
  ) {
    return safeFetch<ContractSigningPreparationDraft>(
      resolveContractPath(routeRegistry.api.contracts.signingPreparationDraft, contractId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )
  },

  async getSigningPreparationDraft(contractId: string) {
    return safeFetch<ContractSigningPreparationDraft | null>(
      resolveContractPath(routeRegistry.api.contracts.signingPreparationDraft, contractId),
      {
        method: 'GET',
        credentials: 'include',
      }
    )
  },

  async sendSigningPreparationDraft(contractId: string) {
    return safeFetch<{ envelopeId: string; contractView: ContractDetailResponse }>(
      resolveContractPath(routeRegistry.api.contracts.signingPreparationSend, contractId),
      {
        method: 'POST',
        credentials: 'include',
      }
    )
  },

  async download(
    contractId: string,
    options?: { documentId?: string }
  ): Promise<ApiResponse<{ signedUrl: string; fileName: string }>> {
    const path = resolveContractPath(routeRegistry.api.contracts.download, contractId)
    const query = new URLSearchParams()
    if (options?.documentId) {
      query.set('documentId', options.documentId)
    }

    const url = query.size > 0 ? `${path}?${query.toString()}` : path

    return safeFetch<{ signedUrl: string; fileName: string }>(url, {
      method: 'GET',
      credentials: 'include',
    })
  },

  async downloadFinalSigningArtifact(
    contractId: string,
    artifact: FinalSigningArtifactType
  ): Promise<ApiResponse<{ blob?: Blob; signedUrl?: string; fileName: string; contentType: string }>> {
    try {
      const path = resolveContractPath(routeRegistry.api.contracts.finalSignedArtifactDownload, contractId)
      const query = new URLSearchParams({ artifact })
      const response = await fetch(`${path}?${query.toString()}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      })

      if (!response.ok) {
        try {
          const parsedError = (await response.json()) as ApiResponse<unknown>
          return {
            ok: false,
            error: {
              code: parsedError.error?.code ?? 'download_failed',
              message: parsedError.error?.message ?? 'Failed to download final signing artifact',
            },
          }
        } catch {
          return {
            ok: false,
            error: {
              code: 'download_failed',
              message: 'Failed to download final signing artifact',
            },
          }
        }
      }

      const responseContentType = response.headers.get('content-type') ?? ''
      if (responseContentType.toLowerCase().includes('application/json')) {
        const parsed = (await response.json()) as ApiResponse<{
          signedUrl?: string
          fileName?: string
          contentType?: string
        }>

        if (!parsed.ok || !parsed.data?.signedUrl) {
          return {
            ok: false,
            error: {
              code: parsed.error?.code ?? 'download_failed',
              message: parsed.error?.message ?? 'Failed to download final signing artifact',
            },
          }
        }

        return {
          ok: true,
          data: {
            signedUrl: parsed.data.signedUrl,
            fileName:
              parsed.data.fileName ??
              (artifact === 'completion_certificate'
                ? 'completion-certificate.pdf'
                : artifact === 'merged_pdf'
                  ? 'completion-certificate-and-signed.pdf'
                  : 'signed-document.pdf'),
            contentType: parsed.data.contentType ?? 'application/pdf',
          },
        }
      }

      const blob = await response.blob()
      const contentType = responseContentType || 'application/pdf'
      const contentDisposition = response.headers.get('content-disposition') ?? ''
      const fileNameMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)/i)
      const rawFileName = fileNameMatch?.[1]?.replace(/"/g, '')
      const resolvedFileName = rawFileName
        ? (() => {
            try {
              return decodeURIComponent(rawFileName)
            } catch {
              return rawFileName
            }
          })()
        : artifact === 'completion_certificate'
          ? 'completion-certificate.pdf'
          : artifact === 'merged_pdf'
            ? 'completion-certificate-and-signed.pdf'
            : 'signed-document.pdf'

      return {
        ok: true,
        data: {
          blob,
          fileName: resolvedFileName,
          contentType,
        },
      }
    } catch {
      return networkErrorResponse<{ blob: Blob; fileName: string; contentType: string }>()
    }
  },

  previewUrl(contractId: string, options?: { documentId?: string; renderAs?: 'binary' | 'html' }): string {
    const path = resolveContractPath(routeRegistry.api.contracts.preview, contractId)
    const query = new URLSearchParams()
    if (options?.documentId) {
      query.set('documentId', options.documentId)
    }
    if (options?.renderAs === 'html') {
      query.set('render', 'html')
    }

    return query.size > 0 ? `${path}?${query.toString()}` : path
  },

  resolveProtectedContractPath,
}

export type {
  ContractRecord,
  ContractDocument,
  DepartmentOption,
  LegalTeamMemberOption,
  ContractTypeOption,
  ContractTimelineEvent,
  ContractActivityReadState,
  ContractActionName,
  ContractAllowedAction,
  ContractAdditionalApprover,
  ContractApproverReminderResponse,
  ContractLegalCollaborator,
  ContractSignatory,
  FinalSigningArtifactType,
  ContractSigningPreparationDraft,
  AdditionalApproverDecisionHistoryRecord,
  AdditionalApproverHistoryResponse,
  ContractDetailResponse,
  DashboardContractsFilter,
  DashboardContractsScope,
  DashboardCountsResponse,
  RepositoryListResponse,
  RepositorySortBy,
  RepositorySortDirection,
  RepositoryDateBasis,
  RepositoryDatePreset,
  RepositoryExportFormat,
  RepositoryExportColumn,
  RepositoryStatusFilter,
}
