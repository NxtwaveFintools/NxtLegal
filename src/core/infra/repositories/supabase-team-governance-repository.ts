import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/service'
import { contractWorkflowIdentities } from '@/core/constants/contracts'
import { DatabaseError, NotFoundError } from '@/core/http/errors'
import { logger } from '@/core/infra/logging/logger'
import type {
  DepartmentSummary,
  ITeamGovernanceRepository,
  LegalAssignment,
  LegalMatrixMutationResult,
  PrimaryRoleMutationResult,
  TeamMutationResult,
} from '@/core/domain/admin/team-governance-service'

type TeamRow = {
  id: string
  name: string
  is_active: boolean | null
  poc_name: string | null
  hod_name: string | null
}

type TeamRoleMappingRow = {
  team_id: string
  email: string
  role_type: 'POC' | 'HOD'
}

type UserRow = {
  id: string
  email: string
  full_name: string | null
}

type LegalAssignmentRow = {
  department_id: string
  user_id: string
}

type TeamRpcRow = {
  team_id: string
  department_name: string
  is_active: boolean
  poc_name?: string | null
  hod_name?: string | null
  poc_email: string | null
  hod_email: string | null
  before_state_snapshot: Record<string, unknown> | null
  after_state_snapshot: Record<string, unknown> | null
}

type PrimaryRoleRpcRow = {
  team_id: string
  role_type: 'POC' | 'HOD'
  previous_email: string | null
  next_email: string
  before_state_snapshot: Record<string, unknown> | null
  after_state_snapshot: Record<string, unknown> | null
}

type LegalMatrixRpcRow = {
  team_id: string
  active_legal_user_ids: string[] | null
  before_state_snapshot: Record<string, unknown> | null
  after_state_snapshot: Record<string, unknown> | null
}

type RpcErrorLike = {
  code?: string
  message?: string
}

class SupabaseTeamGovernanceRepository implements ITeamGovernanceRepository {
  private readonly supabase = createServiceSupabase()

  private isMissingPrimaryRoleRpcSignature(error: RpcErrorLike | null | undefined): boolean {
    const code = (error?.code ?? '').toUpperCase()
    const message = (error?.message ?? '').toLowerCase()

    return code === 'PGRST202' && message.includes('admin_replace_team_role_email') && message.includes('p_new_name')
  }

  private async syncRoleNameAfterLegacyReplacement(params: {
    tenantId: string
    teamId: string
    roleType: 'POC' | 'HOD'
    newEmail: string
    newName: string
  }): Promise<void> {
    const normalizedName = params.newName.trim()
    const normalizedEmail = params.newEmail.trim().toLowerCase()

    const teamNamePatch =
      params.roleType === 'POC'
        ? { poc_name: normalizedName, updated_at: new Date().toISOString() }
        : { hod_name: normalizedName, updated_at: new Date().toISOString() }

    const { error: updateTeamNameError } = await this.supabase
      .from('teams')
      .update(teamNamePatch)
      .eq('tenant_id', params.tenantId)
      .eq('id', params.teamId)
      .is('deleted_at', null)

    if (updateTeamNameError) {
      throw new DatabaseError('Failed to sync role display name after legacy primary role replacement', undefined, {
        errorCode: updateTeamNameError.code,
        errorMessage: updateTeamNameError.message,
      })
    }

    const { error: updateUserNameError } = await this.supabase
      .from('users')
      .update({
        full_name: normalizedName,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', params.tenantId)
      .eq('email', normalizedEmail)
      .is('deleted_at', null)

    if (updateUserNameError) {
      throw new DatabaseError('Failed to sync replacement user name after legacy primary role replacement', undefined, {
        errorCode: updateUserNameError.code,
        errorMessage: updateUserNameError.message,
      })
    }
  }

  private async ensureActiveReplacementUser(params: {
    tenantId: string
    email: string
    fullName: string
    roleType: 'POC' | 'HOD'
  }): Promise<void> {
    const normalizedEmail = params.email.trim().toLowerCase()
    const normalizedName = params.fullName.trim()

    const { data: existingUser, error: existingUserError } = await this.supabase
      .from('users')
      .select('id, is_active, deleted_at, role, full_name')
      .eq('tenant_id', params.tenantId)
      .eq('email', normalizedEmail)
      .limit(1)
      .maybeSingle<{
        id: string
        is_active: boolean
        deleted_at: string | null
        role: string | null
        full_name: string | null
      }>()

    if (existingUserError) {
      throw new DatabaseError('Failed to resolve replacement user before role assignment', undefined, {
        errorCode: existingUserError.code,
        errorMessage: existingUserError.message,
      })
    }

    const desiredRole = params.roleType

    if (!existingUser) {
      const { error: insertUserError } = await this.supabase.from('users').insert([
        {
          tenant_id: params.tenantId,
          email: normalizedEmail,
          full_name: normalizedName,
          role: desiredRole,
          is_active: true,
          password_hash: null,
        },
      ])

      if (insertUserError) {
        throw new DatabaseError('Failed to create replacement user before role assignment', undefined, {
          errorCode: insertUserError.code,
          errorMessage: insertUserError.message,
        })
      }

      return
    }

    const nextRole = (existingUser.role ?? '').trim().toUpperCase()
    const shouldUpdateRole = nextRole === '' || nextRole === 'USER' || nextRole === 'POC' || nextRole === 'HOD'

    const { error: updateUserError } = await this.supabase
      .from('users')
      .update({
        is_active: true,
        deleted_at: null,
        full_name: normalizedName,
        role: shouldUpdateRole ? desiredRole : existingUser.role,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', params.tenantId)
      .eq('id', existingUser.id)

    if (updateUserError) {
      throw new DatabaseError('Failed to activate replacement user before role assignment', undefined, {
        errorCode: updateUserError.code,
        errorMessage: updateUserError.message,
      })
    }
  }

  private async enforceRoleReplacementConsistency(params: {
    tenantId: string
    teamId: string
    roleType: 'POC' | 'HOD'
    previousEmail: string | null
    nextEmail: string
  }): Promise<void> {
    const previousEmail = params.previousEmail?.trim().toLowerCase() ?? null
    const nextEmail = params.nextEmail.trim().toLowerCase()

    if (!previousEmail || !nextEmail || previousEmail === nextEmail) {
      return
    }

    const { data: users, error: usersError } = await this.supabase
      .from('users')
      .select('id, email, token_version')
      .eq('tenant_id', params.tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('email', [previousEmail, nextEmail])

    if (usersError) {
      throw new DatabaseError('Failed to resolve replacement users for role reassignment', undefined, {
        errorCode: usersError.code,
        errorMessage: usersError.message,
      })
    }

    const previousUser = (users ?? []).find((item) => item.email === previousEmail)
    const nextUser = (users ?? []).find((item) => item.email === nextEmail)

    if (!previousUser || !nextUser) {
      return
    }

    const restrictedUserRoles = new Set(['USER', 'POC', 'HOD'])

    const normalizeRole = (role: unknown): string => {
      if (typeof role !== 'string') {
        return 'USER'
      }

      return role.trim().toUpperCase()
    }

    const { data: nextRoleRecord, error: nextRoleError } = await this.supabase
      .from('users')
      .select('role')
      .eq('tenant_id', params.tenantId)
      .eq('id', nextUser.id)
      .is('deleted_at', null)
      .maybeSingle<{ role: string | null }>()

    if (nextRoleError) {
      throw new DatabaseError('Failed to resolve replacement user role state', undefined, {
        errorCode: nextRoleError.code,
        errorMessage: nextRoleError.message,
      })
    }

    const nextCurrentRole = normalizeRole(nextRoleRecord?.role)
    if (restrictedUserRoles.has(nextCurrentRole) && nextCurrentRole !== params.roleType) {
      const { error: setNextRoleError } = await this.supabase
        .from('users')
        .update({
          role: params.roleType,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', params.tenantId)
        .eq('id', nextUser.id)
        .is('deleted_at', null)

      if (setNextRoleError) {
        throw new DatabaseError('Failed to sync replacement user role after role email replacement', undefined, {
          errorCode: setNextRoleError.code,
          errorMessage: setNextRoleError.message,
        })
      }
    }

    if (params.roleType === 'POC') {
      const uploadedByUpdatePayload = {
        uploaded_by_employee_id: nextUser.id,
        uploaded_by_email: nextEmail,
        updated_at: new Date().toISOString(),
      }

      const { error: updateUploadedByEmployeeIdError } = await this.supabase
        .from('contracts')
        .update(uploadedByUpdatePayload)
        .eq('tenant_id', params.tenantId)
        .is('deleted_at', null)
        .eq('department_id', params.teamId)
        .eq('uploaded_by_employee_id', previousUser.id)

      if (updateUploadedByEmployeeIdError) {
        throw new DatabaseError('Failed to reassign POC-owned contracts after email replacement', undefined, {
          errorCode: updateUploadedByEmployeeIdError.code,
          errorMessage: updateUploadedByEmployeeIdError.message,
        })
      }

      const { error: updateUploadedByEmailError } = await this.supabase
        .from('contracts')
        .update(uploadedByUpdatePayload)
        .eq('tenant_id', params.tenantId)
        .is('deleted_at', null)
        .eq('department_id', params.teamId)
        .eq('uploaded_by_email', previousEmail)

      if (updateUploadedByEmailError) {
        throw new DatabaseError('Failed to reassign POC-owned contracts after email replacement', undefined, {
          errorCode: updateUploadedByEmailError.code,
          errorMessage: updateUploadedByEmailError.message,
        })
      }
    } else {
      const assigneeUpdatePayload = {
        current_assignee_employee_id: nextUser.id,
        current_assignee_email: nextEmail,
        updated_at: new Date().toISOString(),
      }

      const { error: updateAssigneeEmployeeIdError } = await this.supabase
        .from('contracts')
        .update(assigneeUpdatePayload)
        .eq('tenant_id', params.tenantId)
        .is('deleted_at', null)
        .eq('department_id', params.teamId)
        .eq('status', 'HOD_PENDING')
        .eq('current_assignee_employee_id', previousUser.id)

      if (updateAssigneeEmployeeIdError) {
        throw new DatabaseError('Failed to reassign HOD-pending contracts after email replacement', undefined, {
          errorCode: updateAssigneeEmployeeIdError.code,
          errorMessage: updateAssigneeEmployeeIdError.message,
        })
      }

      const { error: updateAssigneeEmailError } = await this.supabase
        .from('contracts')
        .update(assigneeUpdatePayload)
        .eq('tenant_id', params.tenantId)
        .is('deleted_at', null)
        .eq('department_id', params.teamId)
        .eq('status', 'HOD_PENDING')
        .eq('current_assignee_email', previousEmail)

      if (updateAssigneeEmailError) {
        throw new DatabaseError('Failed to reassign HOD-pending contracts after email replacement', undefined, {
          errorCode: updateAssigneeEmailError.code,
          errorMessage: updateAssigneeEmailError.message,
        })
      }
    }

    const { error: updateApproversError } = await this.supabase
      .from('contract_additional_approvers')
      .update({
        approver_employee_id: nextUser.id,
        approver_email: nextEmail,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', params.tenantId)
      .is('deleted_at', null)
      .eq('status', 'PENDING')
      .eq('approver_employee_id', previousUser.id)

    if (updateApproversError) {
      throw new DatabaseError('Failed to reassign pending additional approvers after email replacement', undefined, {
        errorCode: updateApproversError.code,
        errorMessage: updateApproversError.message,
      })
    }

    const previousTokenVersion =
      typeof previousUser.token_version === 'number' && Number.isFinite(previousUser.token_version)
        ? Math.max(0, Math.trunc(previousUser.token_version))
        : 0

    const { error: tokenVersionError } = await this.supabase
      .from('users')
      .update({
        token_version: previousTokenVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', params.tenantId)
      .eq('id', previousUser.id)
      .is('deleted_at', null)

    if (tokenVersionError) {
      throw new DatabaseError('Failed to revoke old user sessions after role replacement', undefined, {
        errorCode: tokenVersionError.code,
        errorMessage: tokenVersionError.message,
      })
    }

    const { count: remainingPrimaryRoleCount, error: remainingRoleError } = await this.supabase
      .from('team_role_mappings')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', params.tenantId)
      .eq('email', previousEmail)
      .in('role_type', ['POC', 'HOD'])
      .eq('active_flag', true)
      .is('deleted_at', null)

    if (remainingRoleError) {
      throw new DatabaseError('Failed to validate remaining mapped primary roles for replaced user', undefined, {
        errorCode: remainingRoleError.code,
        errorMessage: remainingRoleError.message,
      })
    }

    if ((remainingPrimaryRoleCount ?? 0) === 0) {
      const { data: previousRoleRecord, error: previousRoleError } = await this.supabase
        .from('users')
        .select('role')
        .eq('tenant_id', params.tenantId)
        .eq('id', previousUser.id)
        .is('deleted_at', null)
        .maybeSingle<{ role: string | null }>()

      if (previousRoleError) {
        throw new DatabaseError('Failed to resolve previous user role state for downgrade', undefined, {
          errorCode: previousRoleError.code,
          errorMessage: previousRoleError.message,
        })
      }

      const previousCurrentRole = normalizeRole(previousRoleRecord?.role)
      if (restrictedUserRoles.has(previousCurrentRole) && previousCurrentRole !== 'USER') {
        const { error: downgradeRoleError } = await this.supabase
          .from('users')
          .update({
            role: 'USER',
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', params.tenantId)
          .eq('id', previousUser.id)
          .is('deleted_at', null)

        if (downgradeRoleError) {
          throw new DatabaseError('Failed to downgrade previous user role after role email replacement', undefined, {
            errorCode: downgradeRoleError.code,
            errorMessage: downgradeRoleError.message,
          })
        }
      }
    }
  }

  async listDepartments(tenantId: string): Promise<DepartmentSummary[]> {
    const { data: teams, error: teamsError } = await this.supabase
      .from('teams')
      .select('id, name, is_active, poc_name, hod_name')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name', { ascending: true })

    if (teamsError) {
      throw new DatabaseError('Failed to load departments', undefined, {
        errorCode: teamsError.code,
        errorMessage: teamsError.message,
      })
    }

    const teamRows = (teams ?? []) as TeamRow[]
    if (teamRows.length === 0) {
      return []
    }

    const teamIds = teamRows.map((team) => team.id)

    const { data: roleMappings, error: roleMappingsError } = await this.supabase
      .from('team_role_mappings')
      .select('team_id, email, role_type')
      .eq('tenant_id', tenantId)
      .eq('active_flag', true)
      .is('deleted_at', null)
      .in('team_id', teamIds)

    if (roleMappingsError) {
      throw new DatabaseError('Failed to load department primary assignments', undefined, {
        errorCode: roleMappingsError.code,
        errorMessage: roleMappingsError.message,
      })
    }

    const { data: legalAssignments, error: legalAssignmentsError } = await this.supabase
      .from('department_legal_assignments')
      .select('department_id, user_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('department_id', teamIds)

    if (legalAssignmentsError) {
      throw new DatabaseError('Failed to load legal assignment matrix', undefined, {
        errorCode: legalAssignmentsError.code,
        errorMessage: legalAssignmentsError.message,
      })
    }

    const uniqueUserIds = Array.from(
      new Set(((legalAssignments ?? []) as LegalAssignmentRow[]).map((item) => item.user_id))
    )

    const userById = new Map<string, UserRow>()
    if (uniqueUserIds.length > 0) {
      const { data: users, error: usersError } = await this.supabase
        .from('users')
        .select('id, email, full_name')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .in('id', uniqueUserIds)

      if (usersError) {
        throw new DatabaseError('Failed to load team assignment users', undefined, {
          errorCode: usersError.code,
          errorMessage: usersError.message,
        })
      }

      for (const user of (users ?? []) as UserRow[]) {
        userById.set(user.id, user)
      }
    }

    const primaryMap = new Map<
      string,
      { hodUserId: string | null; hodEmail: string | null; pocUserId: string | null; pocEmail: string | null }
    >()
    for (const mapping of (roleMappings ?? []) as TeamRoleMappingRow[]) {
      if (!primaryMap.has(mapping.team_id)) {
        primaryMap.set(mapping.team_id, {
          hodUserId: null,
          hodEmail: null,
          pocUserId: null,
          pocEmail: null,
        })
      }

      const current = primaryMap.get(mapping.team_id)
      if (!current) {
        continue
      }

      if (mapping.role_type === 'HOD') {
        current.hodUserId = null
        current.hodEmail = mapping.email
      }

      if (mapping.role_type === 'POC') {
        current.pocUserId = null
        current.pocEmail = mapping.email
      }
    }

    const legalByTeamId = new Map<string, LegalAssignment[]>()
    for (const legalAssignment of (legalAssignments ?? []) as LegalAssignmentRow[]) {
      const user = userById.get(legalAssignment.user_id)
      if (!user) {
        continue
      }

      if (!legalByTeamId.has(legalAssignment.department_id)) {
        legalByTeamId.set(legalAssignment.department_id, [])
      }

      legalByTeamId.get(legalAssignment.department_id)?.push({
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
      })
    }

    const legalDepartment = teamRows.find(
      (team) => team.name.trim().toLowerCase() === contractWorkflowIdentities.legalDepartmentName.trim().toLowerCase()
    )

    if (legalDepartment) {
      const { data: legalRoleUsers, error: legalRoleUsersError } = await this.supabase
        .from('users')
        .select('id, email, full_name')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .eq('role', 'LEGAL_TEAM')
        .order('full_name', { ascending: true })
        .order('email', { ascending: true })

      if (legalRoleUsersError) {
        throw new DatabaseError('Failed to load legal department users by role fallback', undefined, {
          errorCode: legalRoleUsersError.code,
          errorMessage: legalRoleUsersError.message,
        })
      }

      const existingAssignments = legalByTeamId.get(legalDepartment.id) ?? []
      const deduplicatedAssignments = new Map<string, LegalAssignment>()

      for (const assignment of existingAssignments) {
        deduplicatedAssignments.set(assignment.userId, assignment)
      }

      for (const user of ((legalRoleUsers ?? []) as UserRow[]).filter((item) => Boolean(item.id))) {
        if (!deduplicatedAssignments.has(user.id)) {
          deduplicatedAssignments.set(user.id, {
            userId: user.id,
            email: user.email,
            fullName: user.full_name,
          })
        }
      }

      legalByTeamId.set(
        legalDepartment.id,
        Array.from(deduplicatedAssignments.values()).sort((left, right) => left.email.localeCompare(right.email))
      )
    }

    return teamRows.map((team) => {
      const primary = primaryMap.get(team.id)

      return {
        id: team.id,
        name: team.name,
        isActive: team.is_active !== false,
        pocName: team.poc_name,
        hodName: team.hod_name,
        hodUserId: primary?.hodUserId ?? null,
        hodEmail: primary?.hodEmail ?? null,
        pocUserId: primary?.pocUserId ?? null,
        pocEmail: primary?.pocEmail ?? null,
        legalAssignments: legalByTeamId.get(team.id) ?? [],
      }
    })
  }

  async createDepartment(params: {
    tenantId: string
    adminUserId: string
    name: string
    pocEmail: string
    pocName: string
    hodEmail: string
    hodName: string
    reason?: string
  }): Promise<TeamMutationResult> {
    const { data, error } = await this.supabase.rpc('admin_create_department_with_emails', {
      p_tenant_id: params.tenantId,
      p_admin_user_id: params.adminUserId,
      p_department_name: params.name,
      p_poc_email: params.pocEmail,
      p_hod_email: params.hodEmail,
      p_reason: params.reason ?? null,
    })

    if (error) {
      throw new DatabaseError('Failed to create department', undefined, {
        errorCode: error.code,
        errorMessage: error.message,
      })
    }

    const row = ((data ?? [])[0] ?? null) as TeamRpcRow | null
    if (!row) {
      throw new DatabaseError('Department create RPC returned no result')
    }

    const { error: updateNamesError } = await this.supabase
      .from('teams')
      .update({
        poc_name: params.pocName,
        hod_name: params.hodName,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', params.tenantId)
      .eq('id', row.team_id)
      .is('deleted_at', null)

    if (updateNamesError) {
      throw new DatabaseError('Failed to persist department owner names', undefined, {
        errorCode: updateNamesError.code,
        errorMessage: updateNamesError.message,
      })
    }

    const { error: ownerNameAuditError } = await this.supabase.from('audit_logs').insert([
      {
        tenant_id: params.tenantId,
        user_id: params.adminUserId,
        action: 'team.owner_names.updated',
        actor_email: null,
        actor_role: null,
        resource_type: 'team',
        resource_id: row.team_id,
        metadata: {
          poc_name: params.pocName,
          hod_name: params.hodName,
        },
      },
    ])

    if (ownerNameAuditError) {
      throw new DatabaseError('Failed to write department owner-names audit event', undefined, {
        errorCode: ownerNameAuditError.code,
        errorMessage: ownerNameAuditError.message,
      })
    }

    return {
      teamId: row.team_id,
      departmentName: row.department_name,
      isActive: row.is_active,
      pocName: row.poc_name ?? params.pocName,
      hodName: row.hod_name ?? params.hodName,
      pocEmail: row.poc_email,
      hodEmail: row.hod_email,
      beforeStateSnapshot: row.before_state_snapshot ?? {},
      afterStateSnapshot: row.after_state_snapshot ?? {},
    }
  }

  async updateDepartment(params: {
    tenantId: string
    adminUserId: string
    teamId: string
    operation: 'rename' | 'deactivate'
    name?: string
    reason?: string
  }): Promise<TeamMutationResult> {
    const { data, error } = await this.supabase.rpc('admin_update_department', {
      p_tenant_id: params.tenantId,
      p_admin_user_id: params.adminUserId,
      p_team_id: params.teamId,
      p_operation: params.operation.toUpperCase(),
      p_department_name: params.name ?? null,
      p_reason: params.reason ?? null,
    })

    if (error) {
      const message = error.message.toLowerCase()
      if (message.includes('department not found')) {
        throw new NotFoundError('Department', params.teamId)
      }

      throw new DatabaseError('Failed to update department', undefined, {
        errorCode: error.code,
        errorMessage: error.message,
      })
    }

    const row = ((data ?? [])[0] ?? null) as TeamRpcRow | null
    if (!row) {
      throw new DatabaseError('Department update RPC returned no result')
    }

    return {
      teamId: row.team_id,
      departmentName: row.department_name,
      isActive: row.is_active,
      pocName: row.poc_name ?? null,
      hodName: row.hod_name ?? null,
      pocEmail: row.poc_email,
      hodEmail: row.hod_email,
      beforeStateSnapshot: row.before_state_snapshot ?? {},
      afterStateSnapshot: row.after_state_snapshot ?? {},
    }
  }

  async assignPrimaryRole(params: {
    tenantId: string
    adminUserId: string
    teamId: string
    newEmail: string
    newName: string
    roleType: 'POC' | 'HOD'
    reason?: string
  }): Promise<PrimaryRoleMutationResult> {
    await this.ensureActiveReplacementUser({
      tenantId: params.tenantId,
      email: params.newEmail,
      fullName: params.newName,
      roleType: params.roleType,
    })

    let usedLegacyPrimaryRoleRpc = false

    const modernRpc = await this.supabase.rpc('admin_replace_team_role_email', {
      p_tenant_id: params.tenantId,
      p_admin_user_id: params.adminUserId,
      p_team_id: params.teamId,
      p_new_email: params.newEmail,
      p_new_name: params.newName,
      p_role_type: params.roleType,
      p_reason: params.reason ?? null,
    })

    let data = modernRpc.data
    let error = modernRpc.error

    if (this.isMissingPrimaryRoleRpcSignature(error)) {
      const legacyRpc = await this.supabase.rpc('admin_replace_team_role_email', {
        p_tenant_id: params.tenantId,
        p_admin_user_id: params.adminUserId,
        p_team_id: params.teamId,
        p_new_email: params.newEmail,
        p_role_type: params.roleType,
        p_reason: params.reason ?? null,
      })

      data = legacyRpc.data
      error = legacyRpc.error
      usedLegacyPrimaryRoleRpc = true
    }

    if (error) {
      const message = error.message.toLowerCase()
      if (message.includes('department not found')) {
        throw new NotFoundError('Department', params.teamId)
      }

      throw new DatabaseError('Failed to assign primary team role', undefined, {
        errorCode: error.code,
        errorMessage: error.message,
      })
    }

    const row = ((data ?? [])[0] ?? null) as PrimaryRoleRpcRow | null
    if (!row) {
      throw new DatabaseError('Primary assignment RPC returned no result')
    }

    if (usedLegacyPrimaryRoleRpc) {
      await this.syncRoleNameAfterLegacyReplacement({
        tenantId: params.tenantId,
        teamId: params.teamId,
        roleType: row.role_type,
        newEmail: params.newEmail,
        newName: params.newName,
      })
    }

    try {
      await this.enforceRoleReplacementConsistency({
        tenantId: params.tenantId,
        teamId: params.teamId,
        roleType: row.role_type,
        previousEmail: row.previous_email,
        nextEmail: row.next_email,
      })
    } catch (error) {
      logger.warn('Primary role replacement post-sync step failed; keeping RPC result', {
        teamId: params.teamId,
        roleType: row.role_type,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return {
      teamId: row.team_id,
      roleType: row.role_type,
      previousEmail: row.previous_email,
      nextEmail: row.next_email,
      beforeStateSnapshot: row.before_state_snapshot ?? {},
      afterStateSnapshot: row.after_state_snapshot ?? {},
    }
  }

  async setLegalMatrix(params: {
    tenantId: string
    adminUserId: string
    teamId: string
    legalUserIds: string[]
    reason?: string
  }): Promise<LegalMatrixMutationResult> {
    const { data, error } = await this.supabase.rpc('admin_set_department_legal_matrix', {
      p_tenant_id: params.tenantId,
      p_admin_user_id: params.adminUserId,
      p_team_id: params.teamId,
      p_legal_user_ids: params.legalUserIds,
      p_reason: params.reason ?? null,
    })

    if (error) {
      const message = error.message.toLowerCase()
      if (message.includes('department not found')) {
        throw new NotFoundError('Department', params.teamId)
      }

      throw new DatabaseError('Failed to update legal assignment matrix', undefined, {
        errorCode: error.code,
        errorMessage: error.message,
      })
    }

    const row = ((data ?? [])[0] ?? null) as LegalMatrixRpcRow | null
    if (!row) {
      throw new DatabaseError('Legal matrix RPC returned no result')
    }

    return {
      teamId: row.team_id,
      activeLegalUserIds: row.active_legal_user_ids ?? [],
      beforeStateSnapshot: row.before_state_snapshot ?? {},
      afterStateSnapshot: row.after_state_snapshot ?? {},
    }
  }
}

export const supabaseTeamGovernanceRepository = new SupabaseTeamGovernanceRepository()
