import 'server-only'

import { contractStatuses, resolveContractStatusDisplayLabel, type ContractStatus } from '@/core/constants/contracts'
import { AuthorizationError, BusinessRuleError, ConflictError, DatabaseError } from '@/core/http/errors'
import { createServiceSupabase } from '@/lib/supabase/service'
import type {
  AdditionalApproverDecisionHistoryItem,
  ContractDocument,
  DashboardContractFilter,
  ContractAdditionalApprover,
  ContractAllowedAction,
  ContractDetail,
  ContractListItem,
  ContractQueryRepository,
  RepositorySortBy,
  RepositorySortDirection,
  ContractTimelineEvent,
} from '@/core/domain/contracts/contract-query-repository'
import type { ContractActionName } from '@/core/domain/contracts/schemas'

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000'

const actionLabelMap: Record<ContractActionName, string> = {
  'hod.approve': 'Approve (HOD)',
  'hod.reject': 'Reject (HOD)',
  'hod.bypass': 'Bypass to Legal',
  'legal.approve': 'Final Approve',
  'legal.reject': 'Reject (Legal)',
  'legal.query': 'Mark Query',
  'legal.query.reroute': 'Reroute to HOD',
  'approver.approve': 'Approve as Additional Approver',
  'approver.reject': 'Reject as Additional Approver',
}

const remarkRequiredActions = new Set<ContractActionName>([
  'legal.query.reroute',
  'hod.bypass',
  'hod.reject',
  'legal.reject',
  'approver.reject',
])
const bypassAllowedRoles = new Set(['LEGAL_TEAM', 'ADMIN'])

type ContractEntity = {
  id: string
  tenant_id: string
  title: string
  contract_type_id: string
  counterparty_name: string | null
  status: string
  uploaded_by_employee_id: string
  uploaded_by_email: string
  current_assignee_employee_id: string
  current_assignee_email: string
  signatory_name: string
  signatory_designation: string
  signatory_email: string
  background_of_request: string
  department_id: string
  budget_approved: boolean
  request_created_at: string
  hod_approved_at: string | null
  tat_deadline_at: string | null
  tat_breached_at: string | null
  file_name: string | null
  file_size_bytes: number | null
  file_mime_type: string | null
  file_path: string | null
  created_at: string
  updated_at: string
  row_version: number
}

type ContractDocumentEntity = {
  id: string
  document_kind: 'PRIMARY' | 'COUNTERPARTY_SUPPORTING'
  display_name: string
  file_name: string
  file_size_bytes: number
  file_mime_type: string
  created_at: string
}

type TransitionGraphEntity = {
  trigger_action: string
  to_status: string
  allowed_roles: string[]
}

type AdditionalApproverEntity = {
  id: string
  approver_employee_id: string
  approver_email: string
  sequence_order: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  approved_at: string | null
}

type AdditionalApproverContractContext = {
  hasPendingAdditionalApprovers: boolean
  latestAdditionalApproverRejectionReason: string | null
  latestAdditionalApproverRejectionAt: string | null
  isAdditionalApproverActionable: boolean
}

class SupabaseContractQueryRepository implements ContractQueryRepository {
  private readonly validStatuses = new Set<ContractStatus>(Object.values(contractStatuses))

  private assertActorMetadata(params: { actorEmployeeId: string; actorEmail: string; actorRole: string }): void {
    if (!params.actorEmployeeId.trim()) {
      throw new BusinessRuleError('ACTOR_ID_REQUIRED', 'Actor employee ID is required')
    }

    if (!params.actorEmail.trim()) {
      throw new BusinessRuleError('ACTOR_EMAIL_REQUIRED', 'Actor email is required')
    }

    if (!params.actorRole.trim()) {
      throw new BusinessRuleError('ACTOR_ROLE_REQUIRED', 'Actor role is required')
    }
  }

  async listByTenant(params: {
    tenantId: string
    cursor?: string
    limit: number
    role?: string
    employeeId: string
  }): Promise<{ items: ContractListItem[]; nextCursor?: string; total: number }> {
    const supabase = createServiceSupabase()
    const decodedCursor = this.decodeCursor(params.cursor)

    let query = supabase
      .from('contracts_repository_view')
      .select(
        'id, tenant_id, title, status, uploaded_by_employee_id, uploaded_by_email, current_assignee_employee_id, current_assignee_email, hod_approved_at, tat_deadline_at, tat_breached_at, aging_business_days, near_breach, is_tat_breached, created_at, updated_at'
      )
      .eq('tenant_id', params.tenantId)
      .order('created_at', { ascending: false })
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(params.limit + 1)

    if (decodedCursor) {
      query = query.lt('created_at', decodedCursor.createdAt)
    }

    const visibilityFilter = await this.getVisibilityFilter(params.tenantId, params.role, params.employeeId)
    if (visibilityFilter) {
      query = query.or(visibilityFilter)
    }

    let totalQuery = supabase
      .from('contracts_repository_view')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', params.tenantId)

    if (visibilityFilter) {
      totalQuery = totalQuery.or(visibilityFilter)
    }

    const { count: totalCount, error: totalError } = await totalQuery

    if (totalError) {
      throw new DatabaseError('Failed to count contracts', new Error(totalError.message), {
        code: totalError.code,
      })
    }

    const { data, error } = await query

    if (error) {
      throw new DatabaseError('Failed to list contracts', new Error(error.message), {
        code: error.code,
      })
    }

    const rows = (data ?? []) as Array<{
      id: string
      tenant_id: string
      title: string
      status: string
      uploaded_by_employee_id: string
      uploaded_by_email: string
      current_assignee_employee_id: string
      current_assignee_email: string
      hod_approved_at: string | null
      tat_deadline_at: string | null
      tat_breached_at: string | null
      aging_business_days: number | null
      near_breach: boolean
      is_tat_breached: boolean
      created_at: string
      updated_at: string
    }>

    const additionalApproverContext = await this.getAdditionalApproverContractContextMap(
      params.tenantId,
      rows.map((row) => row.id),
      params.employeeId
    )

    const hasNext = rows.length > params.limit
    const items = rows.slice(0, params.limit).map((row) => this.mapListItem(row, additionalApproverContext.get(row.id)))

    const nextCursor = hasNext ? this.encodeCursor(items[items.length - 1]?.createdAt ?? '') : undefined

    return { items, nextCursor, total: totalCount ?? 0 }
  }

  async getPendingApprovalsForRole(params: {
    tenantId: string
    employeeId: string
    role?: string
    limit: number
  }): Promise<ContractListItem[]> {
    const statuses = this.getPendingApprovalStatuses(params.role)

    if (statuses.length === 0) {
      return []
    }

    const supabase = createServiceSupabase()
    let query = supabase
      .from('contracts_repository_view')
      .select(
        'id, tenant_id, title, status, uploaded_by_employee_id, uploaded_by_email, current_assignee_employee_id, current_assignee_email, hod_approved_at, tat_deadline_at, tat_breached_at, aging_business_days, near_breach, is_tat_breached, created_at, updated_at'
      )
      .eq('tenant_id', params.tenantId)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(params.limit)

    if (params.role === 'LEGAL_TEAM') {
      query = query.eq('current_assignee_employee_id', params.employeeId)
    }

    if (params.role === 'HOD') {
      const visibilityFilter = await this.getVisibilityFilter(params.tenantId, params.role, params.employeeId)
      if (visibilityFilter) {
        query = query.or(visibilityFilter)
      }
    }

    const { data, error } = await query

    if (error) {
      throw new DatabaseError('Failed to fetch pending approvals for actor role', new Error(error.message), {
        code: error.code,
      })
    }

    const rows = (data ?? []) as Array<{
      id: string
      title: string
      status: string
      uploaded_by_employee_id: string
      uploaded_by_email: string
      current_assignee_employee_id: string
      current_assignee_email: string
      hod_approved_at: string | null
      tat_deadline_at: string | null
      tat_breached_at: string | null
      aging_business_days: number | null
      near_breach: boolean
      is_tat_breached: boolean
      created_at: string
      updated_at: string
    }>

    const additionalApproverContext = await this.getAdditionalApproverContractContextMap(
      params.tenantId,
      rows.map((row) => row.id),
      params.employeeId
    )

    return rows.map((row) => this.mapListItem(row, additionalApproverContext.get(row.id)))
  }

  async getDashboardContracts(params: {
    tenantId: string
    employeeId: string
    role?: string
    filter: DashboardContractFilter
    cursor?: string
    limit: number
  }): Promise<{ items: ContractListItem[]; nextCursor?: string; total: number }> {
    const resolvedFilter = this.resolveDashboardFilter(params.role, params.filter)
    const statusFilter = this.resolveDashboardStatusFromFilter(resolvedFilter)
    const decodedCursor = this.decodeCursor(params.cursor)
    const supabase = createServiceSupabase()

    let query = supabase
      .from('contracts_repository_view')
      .select(
        'id, tenant_id, title, status, uploaded_by_employee_id, uploaded_by_email, current_assignee_employee_id, current_assignee_email, hod_approved_at, tat_deadline_at, tat_breached_at, aging_business_days, near_breach, is_tat_breached, created_at, updated_at'
      )
      .eq('tenant_id', params.tenantId)
      .order('created_at', { ascending: false })
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(params.limit + 1)

    if (decodedCursor) {
      query = query.lt('created_at', decodedCursor.createdAt)
    }

    if (statusFilter) {
      query = query.eq('status', statusFilter)
    }

    const visibilityFilter = await this.getVisibilityFilter(params.tenantId, params.role, params.employeeId)
    if (visibilityFilter) {
      query = query.or(visibilityFilter)
    }

    let totalQuery = supabase
      .from('contracts_repository_view')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', params.tenantId)

    if (statusFilter) {
      totalQuery = totalQuery.eq('status', statusFilter)
    }

    if (visibilityFilter) {
      totalQuery = totalQuery.or(visibilityFilter)
    }

    const { count: totalCount, error: totalError } = await totalQuery

    if (totalError) {
      throw new DatabaseError('Failed to count dashboard contracts', new Error(totalError.message), {
        code: totalError.code,
      })
    }

    const { data, error } = await query

    if (error) {
      throw new DatabaseError('Failed to fetch dashboard contracts', new Error(error.message), {
        code: error.code,
      })
    }

    const rows = (data ?? []) as Array<{
      id: string
      title: string
      status: string
      uploaded_by_employee_id: string
      uploaded_by_email: string
      current_assignee_employee_id: string
      current_assignee_email: string
      hod_approved_at: string | null
      tat_deadline_at: string | null
      tat_breached_at: string | null
      aging_business_days: number | null
      near_breach: boolean
      is_tat_breached: boolean
      created_at: string
      updated_at: string
    }>

    const additionalApproverContext = await this.getAdditionalApproverContractContextMap(
      params.tenantId,
      rows.map((row) => row.id),
      params.employeeId
    )

    const hasNext = rows.length > params.limit
    const items = rows.slice(0, params.limit).map((row) => this.mapListItem(row, additionalApproverContext.get(row.id)))
    const nextCursor = hasNext ? this.encodeCursor(items[items.length - 1]?.createdAt ?? '') : undefined

    return { items, nextCursor, total: totalCount ?? 0 }
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
    const supabase = createServiceSupabase()
    const decodedCursor = this.decodeCursor(params.cursor)
    const sortBy = params.sortBy ?? 'created_at'
    const sortDirection = params.sortDirection ?? 'desc'

    let query = supabase
      .from('contracts_repository_view')
      .select(
        'id, tenant_id, title, status, uploaded_by_employee_id, uploaded_by_email, current_assignee_employee_id, current_assignee_email, hod_approved_at, tat_deadline_at, tat_breached_at, aging_business_days, near_breach, is_tat_breached, created_at, updated_at'
      )
      .eq('tenant_id', params.tenantId)
      .limit(params.limit + 1)

    let totalQuery = supabase
      .from('contracts_repository_view')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', params.tenantId)

    if (params.status) {
      query = query.eq('status', params.status)
      totalQuery = totalQuery.eq('status', params.status)
    }

    if (params.search) {
      query = query.ilike('title', `%${params.search}%`)
      totalQuery = totalQuery.ilike('title', `%${params.search}%`)
    }

    query = query.order('is_tat_breached', { ascending: false }).order('near_breach', { ascending: false })

    if (sortBy === 'title') {
      query = query.order('title', { ascending: sortDirection === 'asc' }).order('id', { ascending: false })
    } else if (sortBy === 'status') {
      query = query.order('status', { ascending: sortDirection === 'asc' }).order('id', { ascending: false })
    } else if (sortBy === 'hod_approved_at') {
      query = query
        .order('hod_approved_at', { ascending: sortDirection === 'asc', nullsFirst: sortDirection === 'asc' })
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
    } else if (sortBy === 'tat_deadline_at') {
      query = query
        .order('tat_deadline_at', { ascending: sortDirection === 'asc', nullsFirst: sortDirection === 'asc' })
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
    } else {
      query = query
        .order('created_at', { ascending: sortDirection === 'asc' })
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
    }

    if (decodedCursor && sortBy === 'created_at' && sortDirection === 'desc') {
      query = query.lt('created_at', decodedCursor.createdAt)
    }

    const visibilityFilter = await this.getVisibilityFilter(params.tenantId, params.role, params.employeeId)
    if (visibilityFilter) {
      query = query.or(visibilityFilter)
      totalQuery = totalQuery.or(visibilityFilter)
    }

    const { count: totalCount, error: totalError } = await totalQuery

    if (totalError) {
      throw new DatabaseError('Failed to count repository contracts', new Error(totalError.message), {
        code: totalError.code,
      })
    }

    const { data, error } = await query

    if (error) {
      throw new DatabaseError('Failed to list repository contracts', new Error(error.message), {
        code: error.code,
      })
    }

    const rows = (data ?? []) as Array<{
      id: string
      title: string
      status: string
      uploaded_by_employee_id: string
      uploaded_by_email: string
      current_assignee_employee_id: string
      current_assignee_email: string
      hod_approved_at: string | null
      tat_deadline_at: string | null
      tat_breached_at: string | null
      aging_business_days: number | null
      near_breach: boolean
      is_tat_breached: boolean
      created_at: string
      updated_at: string
    }>

    const additionalApproverContext = await this.getAdditionalApproverContractContextMap(
      params.tenantId,
      rows.map((row) => row.id),
      params.employeeId
    )

    const hasNext = rows.length > params.limit
    const items = rows.slice(0, params.limit).map((row) => this.mapListItem(row, additionalApproverContext.get(row.id)))
    const nextCursor =
      sortBy === 'created_at' && sortDirection === 'desc' && hasNext
        ? this.encodeCursor(items[items.length - 1]?.createdAt ?? '')
        : undefined

    return { items, nextCursor, total: totalCount ?? 0 }
  }

  async getById(tenantId: string, contractId: string): Promise<ContractDetail | null> {
    const supabase = createServiceSupabase()

    const { data, error } = await supabase
      .from('contracts')
      .select(
        'id, tenant_id, title, contract_type_id, counterparty_name, status, uploaded_by_employee_id, uploaded_by_email, current_assignee_employee_id, current_assignee_email, signatory_name, signatory_designation, signatory_email, background_of_request, department_id, budget_approved, request_created_at, hod_approved_at, tat_deadline_at, tat_breached_at, file_name, file_size_bytes, file_mime_type, file_path, created_at, updated_at, row_version'
      )
      .eq('tenant_id', tenantId)
      .eq('id', contractId)
      .is('deleted_at', null)
      .single<ContractEntity>()

    if (error) {
      if (error.code === 'PGRST116') {
        return null
      }
      throw new DatabaseError('Failed to fetch contract detail', new Error(error.message), {
        code: error.code,
      })
    }

    const metadata = await this.resolveContractDetailMetadata(tenantId, data.contract_type_id, data.department_id)

    const additionalApproverContext = await this.getAdditionalApproverContractContextMap(tenantId, [data.id], null)
    return this.mapDetail(data, metadata, additionalApproverContext.get(data.id))
  }

  async getActionableAdditionalApprovals(params: {
    tenantId: string
    employeeId: string
    limit: number
  }): Promise<ContractListItem[]> {
    const actionableContractIds = await this.getActionableAdditionalApproverContractIds(
      params.tenantId,
      params.employeeId
    )

    if (actionableContractIds.length === 0) {
      return []
    }

    const supabase = createServiceSupabase()
    const { data, error } = await supabase
      .from('contracts_repository_view')
      .select(
        'id, tenant_id, title, status, uploaded_by_employee_id, uploaded_by_email, current_assignee_employee_id, current_assignee_email, hod_approved_at, tat_deadline_at, tat_breached_at, aging_business_days, near_breach, is_tat_breached, created_at, updated_at'
      )
      .eq('tenant_id', params.tenantId)
      .in('id', actionableContractIds)
      .order('created_at', { ascending: false })
      .limit(params.limit)

    if (error) {
      throw new DatabaseError('Failed to fetch actionable additional approver contracts', new Error(error.message), {
        code: error.code,
      })
    }

    const rows = (data ?? []) as Array<{
      id: string
      title: string
      status: string
      uploaded_by_employee_id: string
      uploaded_by_email: string
      current_assignee_employee_id: string
      current_assignee_email: string
      hod_approved_at: string | null
      tat_deadline_at: string | null
      tat_breached_at: string | null
      aging_business_days: number | null
      near_breach: boolean
      is_tat_breached: boolean
      created_at: string
      updated_at: string
    }>

    const additionalApproverContext = await this.getAdditionalApproverContractContextMap(
      params.tenantId,
      rows.map((row) => row.id),
      params.employeeId
    )

    return rows.map((row) => this.mapListItem(row, additionalApproverContext.get(row.id)))
  }

  async getAdditionalApproverDecisionHistory(params: {
    tenantId: string
    employeeId: string
    role?: string
    cursor?: string
    limit: number
    departmentId?: string
  }): Promise<{ items: AdditionalApproverDecisionHistoryItem[]; nextCursor?: string; total: number }> {
    const supabase = createServiceSupabase()
    const decodedCursor = this.decodeCursor(params.cursor)
    const normalizedRole = (params.role ?? '').toUpperCase()
    const isAdminRole =
      normalizedRole === 'ADMIN' || normalizedRole === 'LEGAL_ADMIN' || normalizedRole === 'SUPER_ADMIN'

    let scopedContractIds: string[] | null = null
    if (params.departmentId) {
      const { data: departmentContracts, error: departmentContractsError } = await supabase
        .from('contracts')
        .select('id')
        .eq('tenant_id', params.tenantId)
        .eq('department_id', params.departmentId)
        .is('deleted_at', null)

      if (departmentContractsError) {
        throw new DatabaseError(
          'Failed to resolve department-filtered contracts for additional approver history',
          new Error(departmentContractsError.message),
          {
            code: departmentContractsError.code,
          }
        )
      }

      scopedContractIds = (departmentContracts ?? []).map((row) => row.id)
      if (scopedContractIds.length === 0) {
        return { items: [], total: 0 }
      }
    }

    let totalQuery = supabase
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', params.tenantId)
      .eq('resource_type', 'contract')
      .in('action', ['contract.approver.approved', 'contract.approver.rejected'])

    if (!isAdminRole) {
      totalQuery = totalQuery.eq('user_id', params.employeeId)
    }

    if (scopedContractIds) {
      totalQuery = totalQuery.in('resource_id', scopedContractIds)
    }

    const { count: totalCount, error: totalError } = await totalQuery

    if (totalError) {
      throw new DatabaseError('Failed to count additional approver decision history', new Error(totalError.message), {
        code: totalError.code,
      })
    }

    let auditQuery = supabase
      .from('audit_logs')
      .select('resource_id, action, actor_email, note_text, created_at')
      .eq('tenant_id', params.tenantId)
      .eq('resource_type', 'contract')
      .in('action', ['contract.approver.approved', 'contract.approver.rejected'])
      .order('created_at', { ascending: false })
      .limit(params.limit + 1)

    if (decodedCursor) {
      auditQuery = auditQuery.lt('created_at', decodedCursor.createdAt)
    }

    if (scopedContractIds) {
      auditQuery = auditQuery.in('resource_id', scopedContractIds)
    }

    if (!isAdminRole) {
      auditQuery = auditQuery.eq('user_id', params.employeeId)
    }

    const { data: auditRows, error: auditError } = await auditQuery

    if (auditError) {
      throw new DatabaseError('Failed to load additional approver decision history', new Error(auditError.message), {
        code: auditError.code,
      })
    }

    const typedAuditRows = (auditRows ?? []) as Array<{
      resource_id: string
      action: string
      actor_email: string | null
      note_text: string | null
      created_at: string
    }>

    if (typedAuditRows.length === 0) {
      return { items: [], total: totalCount ?? 0 }
    }

    const hasNext = typedAuditRows.length > params.limit
    const paginatedRows = typedAuditRows.slice(0, params.limit)

    const contractIds = Array.from(new Set(paginatedRows.map((row) => row.resource_id)))
    const { data: contractRows, error: contractError } = await supabase
      .from('contracts')
      .select('id, title, status, department_id')
      .eq('tenant_id', params.tenantId)
      .is('deleted_at', null)
      .in('id', contractIds)

    if (contractError) {
      throw new DatabaseError(
        'Failed to load contracts for additional approver history',
        new Error(contractError.message),
        {
          code: contractError.code,
        }
      )
    }

    const typedContractRows = (contractRows ?? []) as Array<{
      id: string
      title: string
      status: string
      department_id: string | null
    }>

    const departmentIds = Array.from(
      new Set(typedContractRows.map((row) => row.department_id).filter((value): value is string => Boolean(value)))
    )

    const departmentNameMap = new Map<string, string>()
    if (departmentIds.length > 0) {
      const { data: departments, error: departmentsError } = await supabase
        .from('teams')
        .select('id, name')
        .eq('tenant_id', params.tenantId)
        .in('id', departmentIds)

      if (departmentsError) {
        throw new DatabaseError(
          'Failed to resolve department names for additional approver history',
          new Error(departmentsError.message),
          {
            code: departmentsError.code,
          }
        )
      }

      for (const department of (departments ?? []) as Array<{ id: string; name: string }>) {
        departmentNameMap.set(department.id, department.name)
      }
    }

    const contractMap = new Map<string, { title: string; status: ContractStatus; departmentId: string | null }>()
    for (const row of typedContractRows) {
      this.assertStatus(row.status)
      contractMap.set(row.id, {
        title: row.title,
        status: row.status as ContractStatus,
        departmentId: row.department_id,
      })
    }

    const additionalApproverContext = await this.getAdditionalApproverContractContextMap(
      params.tenantId,
      contractIds,
      params.employeeId
    )

    const items = paginatedRows
      .map((row) => {
        const contract = contractMap.get(row.resource_id)
        if (!contract) {
          return null
        }

        const context = additionalApproverContext.get(row.resource_id)
        return {
          contractId: row.resource_id,
          contractTitle: contract.title,
          contractStatus: contract.status,
          contractDisplayStatusLabel: resolveContractStatusDisplayLabel({
            status: contract.status,
            hasPendingAdditionalApprovers: context?.hasPendingAdditionalApprovers ?? false,
          }),
          departmentId: contract.departmentId,
          departmentName: contract.departmentId ? (departmentNameMap.get(contract.departmentId) ?? null) : null,
          actorEmail: row.actor_email,
          decision: row.action === 'contract.approver.rejected' ? 'REJECTED' : 'APPROVED',
          decidedAt: row.created_at,
          reason: row.action === 'contract.approver.rejected' ? row.note_text : null,
        } as AdditionalApproverDecisionHistoryItem
      })
      .filter((item): item is AdditionalApproverDecisionHistoryItem => Boolean(item))

    const nextCursor = hasNext ? this.encodeCursor(items[items.length - 1]?.decidedAt ?? '') : undefined

    return {
      items,
      nextCursor,
      total: totalCount ?? 0,
    }
  }

  async getDocuments(tenantId: string, contractId: string): Promise<ContractDocument[]> {
    const supabase = createServiceSupabase()

    const { data, error } = await supabase
      .from('contract_documents')
      .select('id, document_kind, display_name, file_name, file_size_bytes, file_mime_type, created_at')
      .eq('tenant_id', tenantId)
      .eq('contract_id', contractId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    if (error) {
      throw new DatabaseError('Failed to fetch contract documents', new Error(error.message), {
        code: error.code,
      })
    }

    const rows = (data ?? []) as ContractDocumentEntity[]

    return rows.map((row) => ({
      id: row.id,
      documentKind: row.document_kind,
      displayName: row.display_name,
      fileName: row.file_name,
      fileSizeBytes: row.file_size_bytes,
      fileMimeType: row.file_mime_type,
      createdAt: row.created_at,
    }))
  }

  private async resolveContractDetailMetadata(
    tenantId: string,
    contractTypeId: string,
    departmentId: string
  ): Promise<{
    contractTypeName?: string
    departmentName?: string
    departmentHodName?: string | null
    departmentHodEmail?: string | null
  }> {
    const supabase = createServiceSupabase()

    const [{ data: contractType }, { data: department }, { data: hodMembers }] = await Promise.all([
      supabase
        .from('contract_types')
        .select('name')
        .eq('tenant_id', tenantId)
        .eq('id', contractTypeId)
        .is('deleted_at', null)
        .maybeSingle<{ name: string }>(),
      supabase
        .from('teams')
        .select('name')
        .eq('tenant_id', tenantId)
        .eq('id', departmentId)
        .is('deleted_at', null)
        .maybeSingle<{ name: string }>(),
      supabase
        .from('team_role_mappings')
        .select('email')
        .eq('tenant_id', tenantId)
        .eq('team_id', departmentId)
        .eq('role_type', 'HOD')
        .eq('active_flag', true)
        .is('deleted_at', null)
        .limit(1),
    ])

    let departmentHodName: string | null = null
    let departmentHodEmail: string | null = null

    const hodEmail = (hodMembers ?? [])[0]?.email
    if (hodEmail) {
      const { data: hodUser } = await supabase
        .from('users')
        .select('full_name, email')
        .eq('tenant_id', tenantId)
        .eq('email', hodEmail)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle<{ full_name: string | null; email: string }>()

      departmentHodName = hodUser?.full_name ?? null
      departmentHodEmail = hodUser?.email ?? null
    }

    return {
      contractTypeName: contractType?.name,
      departmentName: department?.name,
      departmentHodName,
      departmentHodEmail,
    }
  }

  async getTimeline(tenantId: string, contractId: string, limit: number): Promise<ContractTimelineEvent[]> {
    const supabase = createServiceSupabase()

    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, event_type, action, user_id, actor_email, actor_role, target_email, note_text, metadata, created_at')
      .eq('tenant_id', tenantId)
      .eq('resource_type', 'contract')
      .eq('resource_id', contractId)
      .order('event_sequence', { ascending: false })
      .limit(limit)

    if (error) {
      throw new DatabaseError('Failed to fetch contract timeline', new Error(error.message), {
        code: error.code,
      })
    }

    return (data ?? []).map((event) => ({
      id: event.id,
      eventType: event.event_type,
      action: event.action,
      userId: event.user_id,
      actorEmail: event.actor_email,
      actorRole: event.actor_role,
      targetEmail: event.target_email,
      noteText: event.note_text,
      metadata: (event.metadata ?? null) as Record<string, unknown> | null,
      createdAt: event.created_at,
    }))
  }

  async getAdditionalApprovers(tenantId: string, contractId: string): Promise<ContractAdditionalApprover[]> {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase
      .from('contract_additional_approvers')
      .select('id, approver_employee_id, approver_email, sequence_order, status, approved_at')
      .eq('tenant_id', tenantId)
      .eq('contract_id', contractId)
      .is('deleted_at', null)
      .order('sequence_order', { ascending: true })

    if (error) {
      throw new DatabaseError('Failed to fetch additional approvers', new Error(error.message), {
        code: error.code,
      })
    }

    return ((data ?? []) as AdditionalApproverEntity[]).map((row) => ({
      id: row.id,
      approverEmployeeId: row.approver_employee_id,
      approverEmail: row.approver_email,
      sequenceOrder: row.sequence_order,
      status: row.status,
      approvedAt: row.approved_at,
    }))
  }

  async canAccessContract(params: {
    tenantId: string
    actorEmployeeId: string
    actorRole?: string
    contract: ContractDetail
  }): Promise<boolean> {
    return this.canActorAccessContract(params)
  }

  async getAvailableActions(params: {
    tenantId: string
    contract: ContractDetail
    actorEmployeeId: string
    actorRole?: string
  }): Promise<ContractAllowedAction[]> {
    if (!params.actorRole) {
      return []
    }

    const actorRole = params.actorRole

    const transitions = await this.getTransitionsForStatus(params.tenantId, params.contract.status, actorRole)

    const actionsByName = new Map<ContractActionName, ContractAllowedAction>()
    for (const transition of transitions) {
      const actionName = transition.trigger_action as ContractActionName
      if (actionsByName.has(actionName)) {
        continue
      }

      const allowedAction = this.toAllowedAction(actionName)
      if (allowedAction) {
        actionsByName.set(actionName, allowedAction)
      }
    }

    const actionsFromGraph = Array.from(actionsByName.values())

    const pendingApproverCount = await this.getPendingApproverCount(params.tenantId, params.contract.id)
    const firstPendingApprover = await this.getFirstPendingApprover(params.tenantId, params.contract.id)
    const isAssignee = params.contract.currentAssigneeEmployeeId === params.actorEmployeeId

    const actions = actionsFromGraph.filter((item) => {
      const isAdditionalApproverAction = item.action === 'approver.approve' || item.action === 'approver.reject'

      if (params.actorRole !== 'ADMIN' && !isAdditionalApproverAction && !isAssignee) {
        const isHodAction =
          item.action === 'hod.approve' || item.action === 'hod.reject' || item.action === 'hod.bypass'
        if (!(params.actorRole === 'HOD' && isHodAction && params.contract.status === contractStatuses.hodPending)) {
          return false
        }
      }

      if (item.action === 'hod.bypass' && !bypassAllowedRoles.has(actorRole)) {
        return false
      }

      if (item.action === 'legal.approve' && pendingApproverCount > 0) {
        return false
      }

      return true
    })

    if (
      params.contract.status === contractStatuses.legalPending &&
      firstPendingApprover?.approverEmployeeId === params.actorEmployeeId
    ) {
      actions.push(this.toAllowedAction('approver.approve') as ContractAllowedAction)
      actions.push(this.toAllowedAction('approver.reject') as ContractAllowedAction)
    }

    return actions
  }

  async applyAction(params: {
    tenantId: string
    contractId: string
    action: ContractActionName
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    noteText?: string
  }): Promise<ContractDetail> {
    this.assertActorMetadata({
      actorEmployeeId: params.actorEmployeeId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
    })

    const contract = await this.getById(params.tenantId, params.contractId)

    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found')
    }

    const canAccess = await this.canActorAccessContract({
      tenantId: params.tenantId,
      actorEmployeeId: params.actorEmployeeId,
      actorRole: params.actorRole,
      contract,
    })

    if (!canAccess) {
      throw new AuthorizationError('CONTRACT_ACTION_FORBIDDEN', 'You do not have access to this contract')
    }

    const isAssignee = contract.currentAssigneeEmployeeId === params.actorEmployeeId
    const isHodAction =
      params.action === 'hod.approve' || params.action === 'hod.reject' || params.action === 'hod.bypass'
    const allowMappedHodAction =
      params.actorRole === 'HOD' && isHodAction && contract.status === contractStatuses.hodPending

    const isAdditionalApproverAction = params.action === 'approver.approve' || params.action === 'approver.reject'

    if (!isAdditionalApproverAction && params.actorRole !== 'ADMIN' && !isAssignee && !allowMappedHodAction) {
      throw new AuthorizationError('CONTRACT_ACTION_FORBIDDEN', 'Only the current assignee can perform this action')
    }

    if (params.action === 'approver.approve') {
      await this.applyAdditionalApproverApproval({
        tenantId: params.tenantId,
        contract,
        actorEmployeeId: params.actorEmployeeId,
        actorRole: params.actorRole,
        actorEmail: params.actorEmail,
      })

      const unchanged = await this.getById(params.tenantId, params.contractId)
      if (!unchanged) {
        throw new DatabaseError('Failed to load contract after approver action')
      }
      return unchanged
    }

    if (params.action === 'approver.reject') {
      if (!params.noteText?.trim()) {
        throw new BusinessRuleError('REMARK_REQUIRED', 'Remarks are mandatory for this action')
      }

      await this.applyAdditionalApproverRejection({
        tenantId: params.tenantId,
        contract,
        actorEmployeeId: params.actorEmployeeId,
        actorRole: params.actorRole,
        actorEmail: params.actorEmail,
        noteText: params.noteText,
      })

      const unchanged = await this.getById(params.tenantId, params.contractId)
      if (!unchanged) {
        throw new DatabaseError('Failed to load contract after approver rejection action')
      }
      return unchanged
    }

    if (remarkRequiredActions.has(params.action) && !params.noteText?.trim()) {
      throw new BusinessRuleError('REMARK_REQUIRED', 'Remarks are mandatory for this action')
    }

    if (params.action === 'hod.bypass' && !bypassAllowedRoles.has(params.actorRole)) {
      throw new AuthorizationError('CONTRACT_ACTION_FORBIDDEN', 'Only legal team or admin can bypass HOD approval')
    }

    const transition = await this.resolveTransition(params.tenantId, contract.status, params.action)

    if (!transition.allowed_roles.includes(params.actorRole)) {
      throw new AuthorizationError('CONTRACT_ACTION_FORBIDDEN', 'You are not allowed to perform this action')
    }

    const pendingApproverCount = await this.getPendingApproverCount(params.tenantId, params.contractId)
    if (params.action === 'legal.approve' && pendingApproverCount > 0) {
      throw new BusinessRuleError('APPROVERS_PENDING', 'All additional approvers must approve before final approval')
    }

    const supabase = createServiceSupabase()

    let nextStatus = transition.to_status as ContractStatus
    let assigneeEmployeeId = contract.currentAssigneeEmployeeId
    let assigneeEmail = contract.currentAssigneeEmail
    let hodApprovedAt = contract.hodApprovedAt ?? null
    let tatDeadlineAt = contract.tatDeadlineAt ?? null

    if (params.action === 'hod.approve' || params.action === 'hod.bypass') {
      const legalAssignee = await this.getLegalAssignee(params.tenantId)
      assigneeEmployeeId = legalAssignee.id
      assigneeEmail = legalAssignee.email
      nextStatus = contractStatuses.legalPending

      if (params.action === 'hod.approve') {
        const todayUtc = new Date().toISOString().slice(0, 10)
        const { data: deadlineDate, error: deadlineError } = await supabase.rpc('business_day_add', {
          start_date: todayUtc,
          days: 7,
        })

        if (deadlineError || !deadlineDate) {
          throw new DatabaseError(
            'Failed to compute TAT deadline for HOD approval',
            new Error(deadlineError?.message),
            {
              code: deadlineError?.code,
            }
          )
        }

        hodApprovedAt = new Date().toISOString()
        tatDeadlineAt = `${deadlineDate}T23:59:59.000Z`
      }
    } else if (params.action === 'legal.query.reroute') {
      const hodAssignee = await this.getTeamHodAssignee(params.tenantId, contract.departmentId)
      assigneeEmployeeId = hodAssignee.id
      assigneeEmail = hodAssignee.email
      nextStatus = contractStatuses.hodPending
    }

    const updatePayload: {
      status: ContractStatus
      current_assignee_employee_id: string
      current_assignee_email: string
      row_version: number
      hod_approved_at?: string | null
      tat_deadline_at?: string | null
    } = {
      status: nextStatus,
      current_assignee_employee_id: assigneeEmployeeId,
      current_assignee_email: assigneeEmail,
      row_version: contract.rowVersion + 1,
    }

    if (params.action === 'hod.approve') {
      updatePayload.hod_approved_at = hodApprovedAt
      updatePayload.tat_deadline_at = tatDeadlineAt
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from('contracts')
      .update(updatePayload)
      .eq('id', contract.id)
      .eq('tenant_id', params.tenantId)
      .eq('row_version', contract.rowVersion)
      .select('id')
      .maybeSingle<{ id: string }>()

    if (updateError) {
      throw new DatabaseError('Failed to apply contract action', new Error(updateError.message), {
        code: updateError.code,
      })
    }

    if (!updatedRow) {
      throw new ConflictError('Contract was modified by another request. Please refresh and retry.', {
        contractId: params.contractId,
        tenantId: params.tenantId,
        action: params.action,
        expectedRowVersion: contract.rowVersion,
      })
    }

    const { error: auditError } = await supabase.from('audit_logs').insert([
      {
        tenant_id: params.tenantId,
        user_id: params.actorEmployeeId,
        event_type: this.toAuditEventType(params.action),
        action: `contract.${params.action}`,
        actor_email: params.actorEmail,
        actor_role: params.actorRole,
        resource_type: 'contract',
        resource_id: params.contractId,
        target_email: assigneeEmail,
        note_text: params.noteText?.trim() || null,
        metadata: {
          from_status: contract.status,
          to_status: nextStatus,
        },
      },
    ])

    if (auditError) {
      throw new DatabaseError('Failed to write contract audit event', new Error(auditError.message), {
        code: auditError.code,
      })
    }

    const updated = await this.getById(params.tenantId, params.contractId)

    if (!updated) {
      throw new DatabaseError('Failed to load contract after action update')
    }

    return updated
  }

  async addAdditionalApprover(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    approverEmail: string
  }): Promise<void> {
    this.assertActorMetadata({
      actorEmployeeId: params.actorEmployeeId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
    })

    if (params.actorRole !== 'LEGAL_TEAM' && params.actorRole !== 'ADMIN') {
      throw new AuthorizationError('CONTRACT_APPROVER_FORBIDDEN', 'Only legal team can assign additional approvers')
    }

    const contract = await this.getById(params.tenantId, params.contractId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found')
    }

    if (contract.status !== contractStatuses.legalPending) {
      throw new BusinessRuleError(
        'APPROVER_ASSIGN_INVALID_STATUS',
        'Additional approvers can only be assigned in LEGAL_PENDING'
      )
    }

    const supabase = createServiceSupabase()

    const { data: approverUser, error: approverError } = await supabase
      .from('users')
      .select('id, email')
      .eq('tenant_id', params.tenantId)
      .eq('email', params.approverEmail)
      .eq('is_active', true)
      .is('deleted_at', null)
      .single<{ id: string; email: string }>()

    if (approverError || !approverUser) {
      throw new BusinessRuleError('APPROVER_NOT_FOUND', 'Approver must be an active tenant user')
    }

    const existingApprovers = await this.getAdditionalApprovers(params.tenantId, params.contractId)
    if (existingApprovers.some((item) => item.approverEmployeeId === approverUser.id && item.status === 'PENDING')) {
      throw new BusinessRuleError('APPROVER_ALREADY_ASSIGNED', 'Approver is already pending on this contract')
    }

    const nextSequence =
      existingApprovers.length > 0 ? Math.max(...existingApprovers.map((item) => item.sequenceOrder)) + 1 : 1

    const { error: insertError } = await supabase.from('contract_additional_approvers').insert([
      {
        tenant_id: params.tenantId,
        contract_id: params.contractId,
        approver_employee_id: approverUser.id,
        approver_email: approverUser.email,
        sequence_order: nextSequence,
        status: 'PENDING',
        created_by_employee_id: params.actorEmployeeId,
      },
    ])

    if (insertError) {
      throw new DatabaseError('Failed to add additional approver', new Error(insertError.message), {
        code: insertError.code,
      })
    }

    const { error: auditError } = await supabase.from('audit_logs').insert([
      {
        tenant_id: params.tenantId,
        user_id: params.actorEmployeeId,
        event_type: 'CONTRACT_APPROVER_ADDED',
        action: 'contract.approver.added',
        actor_email: params.actorEmail,
        actor_role: params.actorRole,
        resource_type: 'contract',
        resource_id: params.contractId,
        target_email: approverUser.email,
        metadata: {
          sequence_order: nextSequence,
        },
      },
    ])

    if (auditError) {
      throw new DatabaseError('Failed to write approver audit event', new Error(auditError.message), {
        code: auditError.code,
      })
    }
  }

  async addContractNote(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    noteText: string
  }): Promise<void> {
    this.assertActorMetadata({
      actorEmployeeId: params.actorEmployeeId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
    })

    const contract = await this.getById(params.tenantId, params.contractId)
    if (!contract) {
      throw new BusinessRuleError('CONTRACT_NOT_FOUND', 'Contract not found')
    }

    const canAccess = await this.canActorAccessContract({
      tenantId: params.tenantId,
      actorEmployeeId: params.actorEmployeeId,
      actorRole: params.actorRole,
      contract,
    })

    if (!canAccess) {
      throw new AuthorizationError('CONTRACT_NOTE_FORBIDDEN', 'You do not have access to add notes on this contract')
    }

    const supabase = createServiceSupabase()
    const { error } = await supabase.from('audit_logs').insert([
      {
        tenant_id: params.tenantId,
        user_id: params.actorEmployeeId,
        event_type: 'CONTRACT_NOTE_ADDED',
        action: 'contract.note.added',
        actor_email: params.actorEmail,
        actor_role: params.actorRole,
        resource_type: 'contract',
        resource_id: params.contractId,
        note_text: params.noteText.trim(),
      },
    ])

    if (error) {
      throw new DatabaseError('Failed to add contract note', new Error(error.message), {
        code: error.code,
      })
    }
  }

  private async applyAdditionalApproverApproval(params: {
    tenantId: string
    contract: ContractDetail
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
  }): Promise<void> {
    this.assertActorMetadata({
      actorEmployeeId: params.actorEmployeeId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
    })

    if (params.contract.status !== contractStatuses.legalPending) {
      throw new BusinessRuleError(
        'APPROVER_ACTION_INVALID_STATUS',
        'Additional approver can only approve in LEGAL_PENDING'
      )
    }

    const firstPendingApprover = await this.getFirstPendingApprover(params.tenantId, params.contract.id)
    if (!firstPendingApprover || firstPendingApprover.approverEmployeeId !== params.actorEmployeeId) {
      throw new AuthorizationError('APPROVER_ACTION_FORBIDDEN', 'Only the next pending sequential approver can approve')
    }

    const supabase = createServiceSupabase()
    const { data: updatedApprover, error: updateError } = await supabase
      .from('contract_additional_approvers')
      .update({
        status: 'APPROVED',
        approved_at: new Date().toISOString(),
      })
      .eq('tenant_id', params.tenantId)
      .eq('id', firstPendingApprover.id)
      .eq('status', 'PENDING')
      .is('deleted_at', null)
      .select('id')
      .maybeSingle<{ id: string }>()

    if (updateError) {
      throw new DatabaseError('Failed to approve additional approver', new Error(updateError.message), {
        code: updateError.code,
      })
    }

    if (!updatedApprover) {
      throw new ConflictError('Additional approver action was already processed. Please refresh and retry.', {
        contractId: params.contract.id,
        tenantId: params.tenantId,
        action: 'approver.approve',
        approverId: firstPendingApprover.id,
      })
    }

    const { error: auditError } = await supabase.from('audit_logs').insert([
      {
        tenant_id: params.tenantId,
        user_id: params.actorEmployeeId,
        event_type: 'CONTRACT_APPROVER_APPROVED',
        action: 'contract.approver.approved',
        actor_email: params.actorEmail,
        actor_role: params.actorRole,
        resource_type: 'contract',
        resource_id: params.contract.id,
        metadata: {
          approver_id: firstPendingApprover.id,
          sequence_order: firstPendingApprover.sequenceOrder,
        },
      },
    ])

    if (auditError) {
      throw new DatabaseError('Failed to write additional approver audit event', new Error(auditError.message), {
        code: auditError.code,
      })
    }
  }

  private async applyAdditionalApproverRejection(params: {
    tenantId: string
    contract: ContractDetail
    actorEmployeeId: string
    actorRole: string
    actorEmail: string
    noteText: string
  }): Promise<void> {
    this.assertActorMetadata({
      actorEmployeeId: params.actorEmployeeId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
    })

    if (params.contract.status !== contractStatuses.legalPending) {
      throw new BusinessRuleError(
        'APPROVER_ACTION_INVALID_STATUS',
        'Additional approver can only reject in LEGAL_PENDING'
      )
    }

    const firstPendingApprover = await this.getFirstPendingApprover(params.tenantId, params.contract.id)
    if (!firstPendingApprover || firstPendingApprover.approverEmployeeId !== params.actorEmployeeId) {
      throw new AuthorizationError('APPROVER_ACTION_FORBIDDEN', 'Only the next pending sequential approver can reject')
    }

    const supabase = createServiceSupabase()
    const { data: rejectedApprover, error: rejectError } = await supabase
      .from('contract_additional_approvers')
      .update({
        status: 'REJECTED',
        approved_at: null,
      })
      .eq('tenant_id', params.tenantId)
      .eq('id', firstPendingApprover.id)
      .eq('status', 'PENDING')
      .is('deleted_at', null)
      .select('id')
      .maybeSingle<{ id: string }>()

    if (rejectError) {
      throw new DatabaseError('Failed to reject additional approver', new Error(rejectError.message), {
        code: rejectError.code,
      })
    }

    if (!rejectedApprover) {
      throw new ConflictError('Additional approver action was already processed. Please refresh and retry.', {
        contractId: params.contract.id,
        tenantId: params.tenantId,
        action: 'approver.reject',
        approverId: firstPendingApprover.id,
      })
    }

    const { error: pruneError } = await supabase
      .from('contract_additional_approvers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('tenant_id', params.tenantId)
      .eq('contract_id', params.contract.id)
      .eq('status', 'PENDING')
      .gt('sequence_order', firstPendingApprover.sequenceOrder)
      .is('deleted_at', null)

    if (pruneError) {
      throw new DatabaseError('Failed to clear remaining pending additional approvers', new Error(pruneError.message), {
        code: pruneError.code,
      })
    }

    const { error: auditError } = await supabase.from('audit_logs').insert([
      {
        tenant_id: params.tenantId,
        user_id: params.actorEmployeeId,
        event_type: 'CONTRACT_APPROVER_REJECTED',
        action: 'contract.approver.rejected',
        actor_email: params.actorEmail,
        actor_role: params.actorRole,
        resource_type: 'contract',
        resource_id: params.contract.id,
        note_text: params.noteText.trim(),
        metadata: {
          approver_id: firstPendingApprover.id,
          sequence_order: firstPendingApprover.sequenceOrder,
        },
      },
    ])

    if (auditError) {
      throw new DatabaseError(
        'Failed to write additional approver rejection audit event',
        new Error(auditError.message),
        {
          code: auditError.code,
        }
      )
    }
  }

  private async getTransitionsForStatus(
    tenantId: string,
    fromStatus: ContractStatus,
    role: string
  ): Promise<TransitionGraphEntity[]> {
    const supabase = createServiceSupabase()
    const { data: tenantRows, error: tenantError } = await supabase
      .from('contract_transition_graph')
      .select('trigger_action, to_status, allowed_roles')
      .eq('tenant_id', tenantId)
      .eq('from_status', fromStatus)
      .eq('is_active', true)
      .contains('allowed_roles', [role])

    if (tenantError) {
      throw new DatabaseError('Failed to resolve transitions', new Error(tenantError.message), {
        code: tenantError.code,
      })
    }

    if (tenantRows && tenantRows.length > 0) {
      return tenantRows as TransitionGraphEntity[]
    }

    const { data: defaultRows, error: defaultError } = await supabase
      .from('contract_transition_graph')
      .select('trigger_action, to_status, allowed_roles')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .eq('from_status', fromStatus)
      .eq('is_active', true)
      .contains('allowed_roles', [role])

    if (defaultError) {
      throw new DatabaseError('Failed to resolve default transitions', new Error(defaultError.message), {
        code: defaultError.code,
      })
    }

    return (defaultRows ?? []) as TransitionGraphEntity[]
  }

  private async resolveTransition(tenantId: string, fromStatus: ContractStatus, action: ContractActionName) {
    if (action === 'legal.query.reroute') {
      return this.resolveRerouteTransition(tenantId, fromStatus)
    }

    const supabase = createServiceSupabase()

    const { data: tenantTransitions, error } = await supabase
      .from('contract_transition_graph')
      .select('to_status, allowed_roles')
      .eq('tenant_id', tenantId)
      .eq('from_status', fromStatus)
      .eq('trigger_action', action)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(2)

    if (error) {
      throw new DatabaseError('Failed to resolve workflow transition', new Error(error.message), {
        code: error.code,
      })
    }

    if (tenantTransitions && tenantTransitions.length > 1) {
      throw new BusinessRuleError(
        'CONTRACT_TRANSITION_AMBIGUOUS',
        'Multiple active workflow transitions configured for this action'
      )
    }

    if (tenantTransitions && tenantTransitions.length === 1) {
      return tenantTransitions[0] as { to_status: string; allowed_roles: string[] }
    }

    const { data: fallbackTransitions, error: fallbackError } = await supabase
      .from('contract_transition_graph')
      .select('to_status, allowed_roles')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .eq('from_status', fromStatus)
      .eq('trigger_action', action)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(2)

    if (fallbackError) {
      throw new DatabaseError('Failed to resolve default workflow transition', new Error(fallbackError.message), {
        code: fallbackError.code,
      })
    }

    if (fallbackTransitions && fallbackTransitions.length > 1) {
      throw new BusinessRuleError(
        'CONTRACT_TRANSITION_AMBIGUOUS',
        'Multiple default active workflow transitions configured for this action'
      )
    }

    if (!fallbackTransitions || fallbackTransitions.length === 0) {
      throw new BusinessRuleError(
        'CONTRACT_TRANSITION_INVALID',
        'No active workflow transition configured for this action'
      )
    }

    return fallbackTransitions[0] as { to_status: string; allowed_roles: string[] }
  }

  private async resolveRerouteTransition(tenantId: string, fromStatus: ContractStatus) {
    const supabase = createServiceSupabase()

    const loadTransition = async (scopeTenantId: string) => {
      const { data, error } = await supabase
        .from('contract_transition_graph')
        .select('to_status, allowed_roles')
        .eq('tenant_id', scopeTenantId)
        .eq('from_status', fromStatus)
        .eq('trigger_action', 'legal.query.reroute')
        .eq('to_status', contractStatuses.hodPending)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(2)

      if (error) {
        throw new DatabaseError('Failed to resolve reroute transition', new Error(error.message), {
          code: error.code,
        })
      }

      if (data && data.length > 1) {
        throw new BusinessRuleError(
          'CONTRACT_TRANSITION_AMBIGUOUS',
          'Multiple active reroute transitions configured for HOD_PENDING'
        )
      }

      return data
    }

    const tenantTransition = await loadTransition(tenantId)
    if (tenantTransition && tenantTransition.length > 0) {
      return tenantTransition[0] as { to_status: string; allowed_roles: string[] }
    }

    const fallbackTransition = await loadTransition(DEFAULT_TENANT_ID)
    if (fallbackTransition && fallbackTransition.length > 0) {
      return fallbackTransition[0] as { to_status: string; allowed_roles: string[] }
    }

    throw new BusinessRuleError('CONTRACT_TRANSITION_INVALID', 'No active reroute transition configured for HOD')
  }

  private async canActorAccessContract(params: {
    tenantId: string
    actorEmployeeId: string
    actorRole?: string
    contract: ContractDetail
  }): Promise<boolean> {
    if (params.actorRole === 'ADMIN' || params.actorRole === 'LEGAL_TEAM') {
      return true
    }

    if (params.contract.uploadedByEmployeeId === params.actorEmployeeId) {
      return true
    }

    if (
      params.contract.currentAssigneeEmployeeId === params.actorEmployeeId &&
      (params.actorRole === 'HOD' || params.actorRole === 'LEGAL_TEAM')
    ) {
      return true
    }

    if (params.actorRole !== 'HOD') {
      return this.isActionableAdditionalApprover({
        tenantId: params.tenantId,
        contractId: params.contract.id,
        actorEmployeeId: params.actorEmployeeId,
        status: params.contract.status,
      })
    }

    const hodDepartmentIds = await this.getHodDepartmentIds(params.tenantId, params.actorEmployeeId)
    if (hodDepartmentIds.length === 0) {
      return false
    }

    if (hodDepartmentIds.includes(params.contract.departmentId)) {
      return true
    }

    return this.isActionableAdditionalApprover({
      tenantId: params.tenantId,
      contractId: params.contract.id,
      actorEmployeeId: params.actorEmployeeId,
      status: params.contract.status,
    })
  }

  private async getVisibilityFilter(
    tenantId: string,
    role: string | undefined,
    employeeId: string
  ): Promise<string | null> {
    const actionableAdditionalApproverContractIds = await this.getActionableAdditionalApproverContractIds(
      tenantId,
      employeeId
    )
    const actionableApproverFilter =
      actionableAdditionalApproverContractIds.length > 0
        ? `id.in.(${actionableAdditionalApproverContractIds.join(',')})`
        : null

    if (role === 'ADMIN' || role === 'LEGAL_TEAM') {
      return null
    }

    if (role !== 'HOD') {
      const conditions = [`uploaded_by_employee_id.eq.${employeeId}`]
      if (actionableApproverFilter) {
        conditions.push(actionableApproverFilter)
      }
      return conditions.join(',')
    }

    const hodDepartmentIds = await this.getHodDepartmentIds(tenantId, employeeId)
    if (hodDepartmentIds.length === 0) {
      const conditions = [`uploaded_by_employee_id.eq.${employeeId}`]
      if (actionableApproverFilter) {
        conditions.push(actionableApproverFilter)
      }
      return conditions.join(',')
    }

    const serializedIds = hodDepartmentIds.join(',')
    const conditions = [
      `department_id.in.(${serializedIds})`,
      `current_assignee_employee_id.eq.${employeeId}`,
      `uploaded_by_employee_id.eq.${employeeId}`,
    ]
    if (actionableApproverFilter) {
      conditions.push(actionableApproverFilter)
    }

    return conditions.join(',')
  }

  private getPendingApprovalStatuses(role?: string): ContractStatus[] {
    if (role === 'HOD') {
      return [contractStatuses.hodPending]
    }

    if (role === 'LEGAL_TEAM') {
      return [contractStatuses.legalPending]
    }

    if (role === 'ADMIN') {
      return [contractStatuses.hodPending, contractStatuses.legalPending]
    }

    return []
  }

  private resolveDashboardFilter(
    role: string | undefined,
    requestedFilter: DashboardContractFilter
  ): DashboardContractFilter {
    if (role === 'ADMIN') {
      return requestedFilter
    }

    if (role === 'LEGAL_TEAM') {
      if (requestedFilter === 'ALL') {
        return 'LEGAL_PENDING'
      }

      return requestedFilter
    }

    if (role === 'HOD' || role === 'POC') {
      if (requestedFilter === 'ALL') {
        return 'HOD_PENDING'
      }

      return requestedFilter
    }

    return 'HOD_PENDING'
  }

  private resolveDashboardStatusFromFilter(filter: DashboardContractFilter): ContractStatus | null {
    if (filter === 'ALL') {
      return null
    }

    if (filter === 'HOD_PENDING') {
      return contractStatuses.hodPending
    }

    if (filter === 'LEGAL_PENDING') {
      return contractStatuses.legalPending
    }

    if (filter === 'FINAL_APPROVED') {
      return contractStatuses.finalApproved
    }

    return contractStatuses.legalQuery
  }

  private async getHodDepartmentIds(tenantId: string, employeeId: string): Promise<string[]> {
    const supabase = createServiceSupabase()

    const { data: employee, error: employeeError } = await supabase
      .from('users')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('id', employeeId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle<{ email: string }>()

    if (employeeError) {
      throw new DatabaseError(
        'Failed to resolve employee email for HOD access checks',
        new Error(employeeError.message),
        {
          code: employeeError.code,
        }
      )
    }

    if (!employee?.email) {
      return []
    }

    const { data: hodTeams, error: hodTeamsError } = await supabase
      .from('team_role_mappings')
      .select('team_id')
      .eq('tenant_id', tenantId)
      .eq('email', employee.email.toLowerCase())
      .eq('role_type', 'HOD')
      .eq('active_flag', true)
      .is('deleted_at', null)

    if (hodTeamsError) {
      throw new DatabaseError('Failed to resolve HOD departments for access checks', new Error(hodTeamsError.message), {
        code: hodTeamsError.code,
      })
    }

    return Array.from(new Set((hodTeams ?? []).map((member) => member.team_id)))
  }

  private async getPendingApproverCount(tenantId: string, contractId: string): Promise<number> {
    const supabase = createServiceSupabase()
    const { count, error } = await supabase
      .from('contract_additional_approvers')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('contract_id', contractId)
      .eq('status', 'PENDING')
      .is('deleted_at', null)

    if (error) {
      throw new DatabaseError('Failed to evaluate pending approvers', new Error(error.message), {
        code: error.code,
      })
    }

    return count ?? 0
  }

  private async getFirstPendingApprover(
    tenantId: string,
    contractId: string
  ): Promise<ContractAdditionalApprover | null> {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase
      .from('contract_additional_approvers')
      .select('id, approver_employee_id, approver_email, sequence_order, status, approved_at')
      .eq('tenant_id', tenantId)
      .eq('contract_id', contractId)
      .eq('status', 'PENDING')
      .is('deleted_at', null)
      .order('sequence_order', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new DatabaseError('Failed to fetch pending approver', new Error(error.message), {
        code: error.code,
      })
    }

    if (!data) {
      return null
    }

    return {
      id: data.id,
      approverEmployeeId: data.approver_employee_id,
      approverEmail: data.approver_email,
      sequenceOrder: data.sequence_order,
      status: data.status,
      approvedAt: data.approved_at,
    }
  }

  private async getActionableAdditionalApproverContractIds(
    tenantId: string,
    actorEmployeeId: string
  ): Promise<string[]> {
    const supabase = createServiceSupabase()
    const { data: actorPendingRows, error: actorPendingError } = await supabase
      .from('contract_additional_approvers')
      .select('contract_id, sequence_order')
      .eq('tenant_id', tenantId)
      .eq('approver_employee_id', actorEmployeeId)
      .eq('status', 'PENDING')
      .is('deleted_at', null)

    if (actorPendingError) {
      throw new DatabaseError(
        'Failed to load actor pending additional approvals',
        new Error(actorPendingError.message),
        {
          code: actorPendingError.code,
        }
      )
    }

    if (!actorPendingRows || actorPendingRows.length === 0) {
      return []
    }

    const candidateContractIds = Array.from(new Set(actorPendingRows.map((row) => row.contract_id)))
    const { data: legalPendingContracts, error: contractError } = await supabase
      .from('contracts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', contractStatuses.legalPending)
      .in('id', candidateContractIds)

    if (contractError) {
      throw new DatabaseError(
        'Failed to load legal pending contracts for additional approver visibility',
        new Error(contractError.message),
        {
          code: contractError.code,
        }
      )
    }

    const legalPendingContractIds = new Set((legalPendingContracts ?? []).map((row) => row.id))
    if (legalPendingContractIds.size === 0) {
      return []
    }

    const filteredActorPendingRows = actorPendingRows.filter((row) => legalPendingContractIds.has(row.contract_id))
    if (filteredActorPendingRows.length === 0) {
      return []
    }

    const { data: allPendingRows, error: allPendingError } = await supabase
      .from('contract_additional_approvers')
      .select('contract_id, sequence_order')
      .eq('tenant_id', tenantId)
      .eq('status', 'PENDING')
      .is('deleted_at', null)
      .in('contract_id', Array.from(new Set(filteredActorPendingRows.map((row) => row.contract_id))))

    if (allPendingError) {
      throw new DatabaseError(
        'Failed to evaluate sequential pending additional approvals',
        new Error(allPendingError.message),
        {
          code: allPendingError.code,
        }
      )
    }

    const minSequenceByContract = new Map<string, number>()
    for (const row of allPendingRows ?? []) {
      const currentMin = minSequenceByContract.get(row.contract_id)
      if (currentMin === undefined || row.sequence_order < currentMin) {
        minSequenceByContract.set(row.contract_id, row.sequence_order)
      }
    }

    return filteredActorPendingRows
      .filter((row) => row.sequence_order === minSequenceByContract.get(row.contract_id))
      .map((row) => row.contract_id)
  }

  private async isActionableAdditionalApprover(params: {
    tenantId: string
    contractId: string
    actorEmployeeId: string
    status: ContractStatus
  }): Promise<boolean> {
    if (params.status !== contractStatuses.legalPending) {
      return false
    }

    const firstPendingApprover = await this.getFirstPendingApprover(params.tenantId, params.contractId)
    return firstPendingApprover?.approverEmployeeId === params.actorEmployeeId
  }

  private async getAdditionalApproverContractContextMap(
    tenantId: string,
    contractIds: string[],
    actorEmployeeId: string | null
  ): Promise<Map<string, AdditionalApproverContractContext>> {
    const contextMap = new Map<string, AdditionalApproverContractContext>()
    const uniqueContractIds = Array.from(new Set(contractIds)).filter((id) => id.length > 0)

    if (uniqueContractIds.length === 0) {
      return contextMap
    }

    const supabase = createServiceSupabase()

    const { data: pendingRows, error: pendingError } = await supabase
      .from('contract_additional_approvers')
      .select('contract_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'PENDING')
      .is('deleted_at', null)
      .in('contract_id', uniqueContractIds)

    if (pendingError) {
      throw new DatabaseError(
        'Failed to evaluate pending additional approvers for contracts',
        new Error(pendingError.message),
        {
          code: pendingError.code,
        }
      )
    }

    const pendingContractIds = new Set((pendingRows ?? []).map((row) => row.contract_id))

    const { data: rejectionRows, error: rejectionError } = await supabase
      .from('audit_logs')
      .select('resource_id, note_text, created_at')
      .eq('tenant_id', tenantId)
      .eq('resource_type', 'contract')
      .eq('action', 'contract.approver.rejected')
      .in('resource_id', uniqueContractIds)
      .order('created_at', { ascending: false })

    if (rejectionError) {
      throw new DatabaseError(
        'Failed to load additional approver rejection context for contracts',
        new Error(rejectionError.message),
        {
          code: rejectionError.code,
        }
      )
    }

    const latestRejectionByContract = new Map<string, { reason: string | null; at: string | null }>()
    for (const row of (rejectionRows ?? []) as Array<{
      resource_id: string
      note_text: string | null
      created_at: string
    }>) {
      if (!latestRejectionByContract.has(row.resource_id)) {
        latestRejectionByContract.set(row.resource_id, {
          reason: row.note_text,
          at: row.created_at,
        })
      }
    }

    let actionableContractIds = new Set<string>()
    if (actorEmployeeId) {
      actionableContractIds = new Set(await this.getActionableAdditionalApproverContractIds(tenantId, actorEmployeeId))
    }

    for (const contractId of uniqueContractIds) {
      const latestRejection = latestRejectionByContract.get(contractId)
      contextMap.set(contractId, {
        hasPendingAdditionalApprovers: pendingContractIds.has(contractId),
        latestAdditionalApproverRejectionReason: latestRejection?.reason ?? null,
        latestAdditionalApproverRejectionAt: latestRejection?.at ?? null,
        isAdditionalApproverActionable: actionableContractIds.has(contractId),
      })
    }

    return contextMap
  }

  private async getLegalAssignee(tenantId: string): Promise<{ id: string; email: string }> {
    const supabase = createServiceSupabase()

    const { data, error } = await supabase
      .from('users')
      .select('id, email')
      .eq('tenant_id', tenantId)
      .eq('role', 'LEGAL_TEAM')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .single<{ id: string; email: string }>()

    if (error || !data) {
      throw new BusinessRuleError('LEGAL_ASSIGNEE_NOT_FOUND', 'No active legal team member available for routing')
    }

    return data
  }

  private async getTeamHodAssignee(tenantId: string, departmentId: string): Promise<{ id: string; email: string }> {
    const supabase = createServiceSupabase()

    const { data: hodMapping, error: hodMappingError } = await supabase
      .from('team_role_mappings')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('team_id', departmentId)
      .eq('role_type', 'HOD')
      .eq('active_flag', true)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle<{ email: string }>()

    if (hodMappingError || !hodMapping?.email) {
      throw new BusinessRuleError('HOD_ASSIGNEE_NOT_FOUND', 'Department HOD is not configured for reroute')
    }

    const { data: hod, error: hodError } = await supabase
      .from('users')
      .select('id, email')
      .eq('tenant_id', tenantId)
      .eq('email', hodMapping.email)
      .eq('is_active', true)
      .is('deleted_at', null)
      .single<{ id: string; email: string }>()

    if (hodError || !hod) {
      throw new BusinessRuleError('HOD_ASSIGNEE_NOT_FOUND', 'No active HOD found for team routing')
    }

    return hod
  }

  private toAllowedAction(action: ContractActionName): ContractAllowedAction | null {
    if (!(action in actionLabelMap)) {
      return null
    }

    return {
      action,
      label: actionLabelMap[action],
      requiresRemark: remarkRequiredActions.has(action),
    }
  }

  private toAuditEventType(action: ContractActionName): string {
    if (action === 'legal.query' || action === 'legal.query.reroute') {
      return 'CONTRACT_TRANSITIONED'
    }

    if (action === 'hod.reject' || action === 'legal.reject' || action === 'approver.reject') {
      return 'CONTRACT_TRANSITIONED'
    }

    if (action === 'hod.bypass') {
      return 'CONTRACT_BYPASSED'
    }

    return 'CONTRACT_APPROVED'
  }

  private mapListItem(
    row: {
      id: string
      title: string
      status: string
      uploaded_by_employee_id: string
      uploaded_by_email: string
      current_assignee_employee_id: string
      current_assignee_email: string
      hod_approved_at?: string | null
      tat_deadline_at?: string | null
      tat_breached_at?: string | null
      aging_business_days?: number | null
      near_breach?: boolean
      is_tat_breached?: boolean
      created_at: string
      updated_at: string
    },
    additionalApproverContext?: AdditionalApproverContractContext
  ): ContractListItem {
    this.assertStatus(row.status)

    const status = row.status as ContractStatus

    return {
      id: row.id,
      title: row.title,
      status,
      displayStatusLabel: resolveContractStatusDisplayLabel({
        status,
        hasPendingAdditionalApprovers: additionalApproverContext?.hasPendingAdditionalApprovers ?? false,
      }),
      uploadedByEmployeeId: row.uploaded_by_employee_id,
      uploadedByEmail: row.uploaded_by_email,
      currentAssigneeEmployeeId: row.current_assignee_employee_id,
      currentAssigneeEmail: row.current_assignee_email,
      latestAdditionalApproverRejectionReason:
        additionalApproverContext?.latestAdditionalApproverRejectionReason ?? null,
      latestAdditionalApproverRejectionAt: additionalApproverContext?.latestAdditionalApproverRejectionAt ?? null,
      isAdditionalApproverActionable: additionalApproverContext?.isAdditionalApproverActionable ?? false,
      hodApprovedAt: row.hod_approved_at ?? null,
      tatDeadlineAt: row.tat_deadline_at ?? null,
      tatBreachedAt: row.tat_breached_at ?? null,
      agingBusinessDays: row.aging_business_days ?? null,
      nearBreach: Boolean(row.near_breach),
      isTatBreached: Boolean(row.is_tat_breached),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapDetail(
    row: ContractEntity,
    metadata?: {
      contractTypeName?: string
      departmentName?: string
      departmentHodName?: string | null
      departmentHodEmail?: string | null
    },
    additionalApproverContext?: AdditionalApproverContractContext
  ): ContractDetail {
    this.assertStatus(row.status)

    const status = row.status as ContractStatus

    return {
      id: row.id,
      title: row.title,
      contractTypeId: row.contract_type_id,
      contractTypeName: metadata?.contractTypeName,
      counterpartyName: row.counterparty_name,
      status,
      displayStatusLabel: resolveContractStatusDisplayLabel({
        status,
        hasPendingAdditionalApprovers: additionalApproverContext?.hasPendingAdditionalApprovers ?? false,
      }),
      uploadedByEmployeeId: row.uploaded_by_employee_id,
      uploadedByEmail: row.uploaded_by_email,
      currentAssigneeEmployeeId: row.current_assignee_employee_id,
      currentAssigneeEmail: row.current_assignee_email,
      latestAdditionalApproverRejectionReason:
        additionalApproverContext?.latestAdditionalApproverRejectionReason ?? null,
      latestAdditionalApproverRejectionAt: additionalApproverContext?.latestAdditionalApproverRejectionAt ?? null,
      isAdditionalApproverActionable: additionalApproverContext?.isAdditionalApproverActionable ?? false,
      departmentId: row.department_id,
      departmentName: metadata?.departmentName,
      departmentHodName: metadata?.departmentHodName,
      departmentHodEmail: metadata?.departmentHodEmail,
      signatoryName: row.signatory_name,
      signatoryDesignation: row.signatory_designation,
      signatoryEmail: row.signatory_email,
      backgroundOfRequest: row.background_of_request,
      budgetApproved: row.budget_approved,
      requestCreatedAt: row.request_created_at,
      hodApprovedAt: row.hod_approved_at,
      tatDeadlineAt: row.tat_deadline_at,
      tatBreachedAt: row.tat_breached_at,
      fileName: row.file_name ?? '',
      fileSizeBytes: row.file_size_bytes ?? 0,
      fileMimeType: row.file_mime_type ?? '',
      filePath: row.file_path ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rowVersion: row.row_version,
    }
  }

  private encodeCursor(createdAt: string): string {
    return Buffer.from(createdAt).toString('base64')
  }

  private decodeCursor(cursor?: string): { createdAt: string } | null {
    if (!cursor) {
      return null
    }

    try {
      const createdAt = Buffer.from(cursor, 'base64').toString('utf8')
      if (!createdAt) {
        return null
      }
      return { createdAt }
    } catch {
      return null
    }
  }

  private assertStatus(status: string): void {
    if (!this.validStatuses.has(status as ContractStatus)) {
      throw new DatabaseError('Invalid contract status found in database', undefined, {
        status,
      })
    }
  }
}

export const supabaseContractQueryRepository = new SupabaseContractQueryRepository()
