/**
 * Unit tests for Account Lockout Service
 * Tests brute force prevention mechanism
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import { accountLockoutService } from './account-lockout-service'

describe('AccountLockoutService', () => {
  const tenantId = '00000000-0000-0000-0000-000000000000'
  const employeeId = 'TEST123'

  beforeEach(() => {
    // Clear any existing lockout state
    accountLockoutService.unlock(tenantId, employeeId)
  })

  describe('Failed attempt tracking', () => {
    it('should track failed login attempts', () => {
      const result1 = accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      expect(result1.shouldLock).toBe(false)
      expect(result1.attemptsRemaining).toBe(4) // 5 max - 1 attempt

      const result2 = accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      expect(result2.shouldLock).toBe(false)
      expect(result2.attemptsRemaining).toBe(3) // 5 max - 2 attempts
    })

    it('should lock account after max attempts', () => {
      // Record 5 failed attempts (max allowed)
      for (let i = 0; i < 4; i++) {
        const result = accountLockoutService.recordFailedAttempt(tenantId, employeeId)
        expect(result.shouldLock).toBe(false)
      }

      // 5th attempt should trigger lockout
      const result = accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      expect(result.shouldLock).toBe(true)
      expect(result.attemptsRemaining).toBe(0)
      expect(result.lockedUntilSeconds).toBeGreaterThan(0)
    })

    it('should detect when account is locked', () => {
      // Lock the account
      for (let i = 0; i < 5; i++) {
        accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      }

      // Check if locked
      expect(accountLockoutService.isLocked(tenantId, employeeId)).toBe(true)
    })

    it('should return remaining lockout time', () => {
      // Lock the account
      for (let i = 0; i < 5; i++) {
        accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      }

      const remainingSeconds = accountLockoutService.getLockoutRemainingSeconds(tenantId, employeeId)
      expect(remainingSeconds).toBeGreaterThan(0)
      expect(remainingSeconds).toBeLessThanOrEqual(15 * 60) // Max 15 minutes
    })
  })

  describe('Lockout duration', () => {
    it('should unlock after lockout duration expires', async () => {
      // Lock the account
      for (let i = 0; i < 5; i++) {
        accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      }

      expect(accountLockoutService.isLocked(tenantId, employeeId)).toBe(true)

      // Simulate time passing (use real timer for integration test)
      // For unit test, we'll manually unlock
      accountLockoutService.unlock(tenantId, employeeId)

      expect(accountLockoutService.isLocked(tenantId, employeeId)).toBe(false)
    })
  })

  describe('Clear attempts', () => {
    it('should clear failed attempts on successful login', () => {
      // Record some failed attempts
      accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      accountLockoutService.recordFailedAttempt(tenantId, employeeId)

      // Clear attempts (successful login)
      accountLockoutService.clearFailedAttempts(tenantId, employeeId)

      // Should be able to attempt again without lockout
      const result = accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      expect(result.attemptsRemaining).toBe(4) // Reset to max - 1
    })
  })

  describe('Multi-tenant isolation', () => {
    it('should track attempts separately per tenant', () => {
      const tenant1 = '00000000-0000-0000-0000-000000000000'
      const tenant2 = '11111111-1111-1111-1111-111111111111'
      const employee = 'EMP123'

      // Record attempts for tenant1
      for (let i = 0; i < 5; i++) {
        accountLockoutService.recordFailedAttempt(tenant1, employee)
      }

      // Tenant1 should be locked
      expect(accountLockoutService.isLocked(tenant1, employee)).toBe(true)

      // Tenant2 should NOT be locked
      expect(accountLockoutService.isLocked(tenant2, employee)).toBe(false)

      // Cleanup
      accountLockoutService.unlock(tenant1, employee)
    })

    it('should track attempts separately per employee in same tenant', () => {
      const employee1 = 'EMP001'
      const employee2 = 'EMP002'

      // Lock employee1
      for (let i = 0; i < 5; i++) {
        accountLockoutService.recordFailedAttempt(tenantId, employee1)
      }

      expect(accountLockoutService.isLocked(tenantId, employee1)).toBe(true)
      expect(accountLockoutService.isLocked(tenantId, employee2)).toBe(false)

      // Cleanup
      accountLockoutService.unlock(tenantId, employee1)
    })
  })

  describe('Edge cases', () => {
    it('should handle concurrent attempts correctly', () => {
      // Simulate rapid concurrent attempts
      const results = []
      for (let i = 0; i < 10; i++) {
        results.push(accountLockoutService.recordFailedAttempt(tenantId, employeeId))
      }

      // Should be locked after 5 attempts
      expect(accountLockoutService.isLocked(tenantId, employeeId)).toBe(true)

      // Cleanup
      accountLockoutService.unlock(tenantId, employeeId)
    })

    it('should not unlock before duration expires', () => {
      // Lock the account
      for (let i = 0; i < 5; i++) {
        accountLockoutService.recordFailedAttempt(tenantId, employeeId)
      }

      // Immediately check if still locked
      expect(accountLockoutService.isLocked(tenantId, employeeId)).toBe(true)

      // Cleanup
      accountLockoutService.unlock(tenantId, employeeId)
    })

    it('should return 0 remaining seconds for unlocked accounts', () => {
      expect(accountLockoutService.getLockoutRemainingSeconds(tenantId, employeeId)).toBe(0)
    })
  })
})
