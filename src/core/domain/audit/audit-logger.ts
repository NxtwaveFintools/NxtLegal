/**
 * Domain-layer audit logging service (pure business logic)
 * Logs all mutations for compliance and audit trails
 */

export type AuditAction =
  | 'employee.created'
  | 'employee.updated'
  | 'employee.deleted'
  | 'employee.restored'
  | 'contract.created'
  | 'contract.updated'
  | 'contract.deleted'
  | 'contract.executed'
  | 'tenant.created'
  | 'tenant.updated'
  | 'tenant.deleted'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.token_refresh'

export type AuditEntry = {
  id?: string
  tenantId: string
  userId: string
  action: AuditAction
  resourceType: string
  resourceId: string
  changes?: Record<string, { before: unknown; after: unknown }>
  metadata?: Record<string, unknown>
  createdAt?: string
}

export interface IAuditRepository {
  log(entry: AuditEntry): Promise<void>
  listByTenant(
    tenantId: string,
    filters?: { resourceType?: string; userId?: string; action?: AuditAction }
  ): Promise<AuditEntry[]>
}

export class AuditLogger {
  constructor(private auditRepository: IAuditRepository) {}

  async logAction(entry: AuditEntry): Promise<void> {
    // Validate required fields
    if (!entry.tenantId || !entry.userId || !entry.action || !entry.resourceType || !entry.resourceId) {
      throw new Error('Missing required audit fields: tenantId, userId, action, resourceType, resourceId')
    }

    // Delegate to repository for persistence
    await this.auditRepository.log(entry)
  }

  async logEmployeeCreation(
    tenantId: string,
    userId: string,
    employeeId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await this.logAction({
      tenantId,
      userId,
      action: 'employee.created',
      resourceType: 'employee',
      resourceId: employeeId,
      changes: { created: { before: null, after: data } },
    })
  }

  async logEmployeeDeletion(tenantId: string, userId: string, employeeId: string, reason?: string): Promise<void> {
    await this.logAction({
      tenantId,
      userId,
      action: 'employee.deleted',
      resourceType: 'employee',
      resourceId: employeeId,
      metadata: { reason: reason ?? 'soft delete' },
    })
  }

  async logLogin(tenantId: string, userId: string, method: 'password' | 'oauth'): Promise<void> {
    await this.logAction({
      tenantId,
      userId,
      action: 'auth.login',
      resourceType: 'auth_session',
      resourceId: userId,
      metadata: { method },
    })
  }

  async logLogout(tenantId: string, userId: string): Promise<void> {
    await this.logAction({
      tenantId,
      userId,
      action: 'auth.logout',
      resourceType: 'auth_session',
      resourceId: userId,
    })
  }
}
