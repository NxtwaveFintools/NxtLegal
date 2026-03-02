import { adminGovernance } from '@/core/constants/admin-governance'
import { AuthorizationError, ValidationError } from '@/core/http/errors'
import type { SessionData } from '@/core/infra/session/jwt-session-store'
import { hashPassword } from '@/lib/auth/password'

export type AdminRoleOption = {
  roleKey: string
  displayName: string
}

export type AdminDepartmentAssignment = {
  departmentId: string
  departmentName: string
  departmentRole: 'POC' | 'HOD'
}

export type AdminUserOption = {
  id: string
  email: string
  fullName: string | null
  isActive: boolean
  roles: string[]
  departmentAssignments: AdminDepartmentAssignment[]
}

export type AdminDepartmentUserGroup = {
  departmentId: string
  departmentName: string
  isDepartmentActive: boolean
  users: Array<{
    id: string
    email: string
    fullName: string | null
    isActive: boolean
    roles: string[]
    departmentRole: 'POC' | 'HOD'
  }>
}

export interface IAdminQueryRepository {
  listRoles(tenantId: string): Promise<AdminRoleOption[]>
  listUsers(tenantId: string): Promise<AdminUserOption[]>
  listUsersGroupedByDepartment(tenantId: string): Promise<AdminDepartmentUserGroup[]>
  createUser(params: {
    tenantId: string
    adminUserId: string
    email: string
    fullName?: string
    role: 'USER' | 'LEGAL_TEAM'
    isActive: boolean
    passwordHash: string
  }): Promise<AdminUserOption>
  setUserStatus(params: {
    tenantId: string
    adminUserId: string
    userId: string
    isActive: boolean
  }): Promise<AdminUserOption>
  assignUserDepartmentRole(params: {
    tenantId: string
    adminUserId: string
    userId: string
    departmentId: string
    departmentRole: 'POC' | 'HOD'
  }): Promise<void>
}

const adminRolesSet = new Set<string>(adminGovernance.adminActorRoles)

export class AdminQueryService {
  constructor(private readonly adminQueryRepository: IAdminQueryRepository) {}

  private assertAdminSession(session: SessionData) {
    if (!session.tenantId) {
      throw new ValidationError('Session tenant is required')
    }

    if (!session.employeeId) {
      throw new ValidationError('Session user is required')
    }

    const actorRole = (session.role ?? '').toUpperCase()
    if (!adminRolesSet.has(actorRole)) {
      throw new AuthorizationError('FORBIDDEN_ADMIN_CONSOLE', 'Insufficient permissions to access admin console')
    }
  }

  async listRoles(session: SessionData): Promise<AdminRoleOption[]> {
    this.assertAdminSession(session)
    return this.adminQueryRepository.listRoles(session.tenantId as string)
  }

  async listUsers(session: SessionData): Promise<AdminUserOption[]> {
    this.assertAdminSession(session)
    return this.adminQueryRepository.listUsers(session.tenantId as string)
  }

  async listUsersGroupedByDepartment(session: SessionData): Promise<AdminDepartmentUserGroup[]> {
    this.assertAdminSession(session)
    return this.adminQueryRepository.listUsersGroupedByDepartment(session.tenantId as string)
  }

  async createUser(params: {
    session: SessionData
    email: string
    fullName?: string
    role: 'USER' | 'LEGAL_TEAM'
    isActive: boolean
  }): Promise<AdminUserOption> {
    this.assertAdminSession(params.session)

    const passwordHash = await hashPassword(adminGovernance.developmentDefaultPassword)

    return this.adminQueryRepository.createUser({
      tenantId: params.session.tenantId as string,
      adminUserId: params.session.employeeId as string,
      email: params.email,
      fullName: params.fullName,
      role: params.role,
      isActive: params.isActive,
      passwordHash,
    })
  }

  async setUserStatus(params: { session: SessionData; userId: string; isActive: boolean }): Promise<AdminUserOption> {
    this.assertAdminSession(params.session)

    return this.adminQueryRepository.setUserStatus({
      tenantId: params.session.tenantId as string,
      adminUserId: params.session.employeeId as string,
      userId: params.userId,
      isActive: params.isActive,
    })
  }

  async assignUserDepartmentRole(params: {
    session: SessionData
    userId: string
    departmentId: string
    departmentRole: 'POC' | 'HOD'
  }): Promise<void> {
    this.assertAdminSession(params.session)

    await this.adminQueryRepository.assignUserDepartmentRole({
      tenantId: params.session.tenantId as string,
      adminUserId: params.session.employeeId as string,
      userId: params.userId,
      departmentId: params.departmentId,
      departmentRole: params.departmentRole,
    })
  }
}
