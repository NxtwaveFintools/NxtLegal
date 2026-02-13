/**
 * Unit tests for AuditLogger
 */

import { AuditLogger } from '@/core/domain/audit/audit-logger'
import type { IAuditRepository } from '@/core/domain/audit/audit-logger'

// Mock repository
const mockAuditRepository: jest.Mocked<IAuditRepository> = {
  log: jest.fn(),
  listByTenant: jest.fn(),
}

describe('AuditLogger', () => {
  let auditLogger: AuditLogger

  beforeEach(() => {
    jest.clearAllMocks()
    auditLogger = new AuditLogger(mockAuditRepository)
  })

  describe('logAction', () => {
    it('should log action with all required fields', async () => {
      const entry = {
        tenantId: 'tenant-001',
        userId: 'user-001',
        action: 'employee.created' as const,
        resourceType: 'employee',
        resourceId: 'emp-001',
      }

      await auditLogger.logAction(entry)

      expect(mockAuditRepository.log).toHaveBeenCalledWith(entry)
    })

    it('should reject missing required fields', async () => {
      const incompleteEntry = {
        tenantId: 'tenant-001',
        userId: '', // Missing
        action: 'employee.created' as const,
        resourceType: 'employee',
        resourceId: 'emp-001',
      }

      await expect(auditLogger.logAction(incompleteEntry)).rejects.toThrow()
      expect(mockAuditRepository.log).not.toHaveBeenCalled()
    })

    it('should log with metadata', async () => {
      const entry = {
        tenantId: 'tenant-001',
        userId: 'user-001',
        action: 'auth.login' as const,
        resourceType: 'auth_session',
        resourceId: 'user-001',
        metadata: { method: 'oauth' as const },
      }

      await auditLogger.logAction(entry)

      expect(mockAuditRepository.log).toHaveBeenCalledWith(entry)
    })
  })

  describe('logEmployeeCreation', () => {
    it('should log employee creation with changes', async () => {
      const tenantId = 'tenant-001'
      const userId = 'admin-001'
      const employeeId = 'emp-001'
      const data = {
        email: 'newemployee@company.com',
        fullName: 'Jane Smith',
        role: 'contract_manager',
      }

      await auditLogger.logEmployeeCreation(tenantId, userId, employeeId, data)

      expect(mockAuditRepository.log).toHaveBeenCalledWith({
        tenantId,
        userId,
        action: 'employee.created',
        resourceType: 'employee',
        resourceId: employeeId,
        changes: { created: { before: null, after: data } },
      })
    })
  })

  describe('logEmployeeDeletion', () => {
    it('should log soft deletion with reason', async () => {
      const tenantId = 'tenant-001'
      const userId = 'admin-001'
      const employeeId = 'emp-001'
      const reason = 'Employee terminated'

      await auditLogger.logEmployeeDeletion(tenantId, userId, employeeId, reason)

      expect(mockAuditRepository.log).toHaveBeenCalledWith({
        tenantId,
        userId,
        action: 'employee.deleted',
        resourceType: 'employee',
        resourceId: employeeId,
        metadata: { reason },
      })
    })
  })

  describe('logLogin', () => {
    it('should log password login', async () => {
      const tenantId = 'tenant-001'
      const userId = 'user-001'

      await auditLogger.logLogin(tenantId, userId, 'password')

      expect(mockAuditRepository.log).toHaveBeenCalledWith({
        tenantId,
        userId,
        action: 'auth.login',
        resourceType: 'auth_session',
        resourceId: userId,
        metadata: { method: 'password' },
      })
    })

    it('should log OAuth login', async () => {
      const tenantId = 'tenant-001'
      const userId = 'user-001'

      await auditLogger.logLogin(tenantId, userId, 'oauth')

      expect(mockAuditRepository.log).toHaveBeenCalledWith({
        tenantId,
        userId,
        action: 'auth.login',
        resourceType: 'auth_session',
        resourceId: userId,
        metadata: { method: 'oauth' },
      })
    })
  })

  describe('logLogout', () => {
    it('should log logout', async () => {
      const tenantId = 'tenant-001'
      const userId = 'user-001'

      await auditLogger.logLogout(tenantId, userId)

      expect(mockAuditRepository.log).toHaveBeenCalledWith({
        tenantId,
        userId,
        action: 'auth.logout',
        resourceType: 'auth_session',
        resourceId: userId,
      })
    })
  })

  describe('Multi-tenant isolation', () => {
    it('should enforce tenant isolation in audit logs', async () => {
      const tenantA = 'tenant-a'
      const tenantB = 'tenant-b'

      // Log action for tenant A
      await auditLogger.logLogin(tenantA, 'user-1', 'password')

      // Log action for tenant B
      await auditLogger.logLogin(tenantB, 'user-2', 'password')

      // Verify both logs are separated by tenant
      expect(mockAuditRepository.log).toHaveBeenCalledTimes(2)
      expect(mockAuditRepository.log).toHaveBeenNthCalledWith(1, expect.objectContaining({ tenantId: tenantA }))
      expect(mockAuditRepository.log).toHaveBeenNthCalledWith(2, expect.objectContaining({ tenantId: tenantB }))
    })
  })
})
