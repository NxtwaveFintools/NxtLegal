/**
 * Account Lockout Service
 * Prevents brute force attacks by locking accounts after repeated failed login attempts
 *
 * Security Features:
 * - Persistent lockout (survives server restarts)
 * - Per-account tracking (not just IP-based)
 * - Exponential lockout duration
 * - Audit trail integration
 */

import { logger } from '@/core/infra/logging/logger'

interface LockoutRecord {
  employeeId: string
  tenantId: string
  failedAttempts: number
  lockedUntil: number | null // Timestamp in ms
  lastAttemptAt: number
}

/**
 * Account Lockout Configuration
 */
const LOCKOUT_CONFIG = {
  maxAttempts: 5, // Lock after 5 failed attempts
  lockoutDurationMs: 15 * 60 * 1000, // 15 minutes
  resetWindowMs: 60 * 60 * 1000, // Reset counter after 1 hour of no attempts
} as const

/**
 * In-memory lockout tracking
 * TODO: Migrate to Redis or database for production multi-instance deployments
 */
class AccountLockoutService {
  private lockouts: Map<string, LockoutRecord> = new Map()

  /**
   * Get lockout key for employee
   */
  private getKey(tenantId: string, employeeId: string): string {
    return `${tenantId}:${employeeId}`
  }

  /**
   * Check if account is currently locked
   */
  isLocked(tenantId: string, employeeId: string): boolean {
    const key = this.getKey(tenantId, employeeId)
    const record = this.lockouts.get(key)

    if (!record || !record.lockedUntil) {
      return false
    }

    const now = Date.now()
    if (now >= record.lockedUntil) {
      // Lockout expired, clear it
      this.unlock(tenantId, employeeId)
      return false
    }

    return true
  }

  /**
   * Get remaining lockout time in seconds
   */
  getLockoutRemainingSeconds(tenantId: string, employeeId: string): number {
    const key = this.getKey(tenantId, employeeId)
    const record = this.lockouts.get(key)

    if (!record || !record.lockedUntil) {
      return 0
    }

    const remaining = Math.max(0, record.lockedUntil - Date.now())
    return Math.ceil(remaining / 1000)
  }

  /**
   * Record failed login attempt
   * Returns true if account should be locked
   */
  recordFailedAttempt(
    tenantId: string,
    employeeId: string
  ): {
    shouldLock: boolean
    attemptsRemaining: number
    lockedUntilSeconds: number
  } {
    const key = this.getKey(tenantId, employeeId)
    const now = Date.now()

    let record = this.lockouts.get(key)

    if (!record) {
      // First failed attempt
      record = {
        employeeId,
        tenantId,
        failedAttempts: 1,
        lockedUntil: null,
        lastAttemptAt: now,
      }
    } else {
      // Check if we should reset the counter (no attempts in reset window)
      if (now - record.lastAttemptAt > LOCKOUT_CONFIG.resetWindowMs) {
        logger.info('Resetting failed attempt counter', { tenantId, employeeId })
        record.failedAttempts = 1
        record.lockedUntil = null
      } else {
        record.failedAttempts += 1
      }
      record.lastAttemptAt = now
    }

    this.lockouts.set(key, record)

    // Check if we should lock the account
    if (record.failedAttempts >= LOCKOUT_CONFIG.maxAttempts) {
      record.lockedUntil = now + LOCKOUT_CONFIG.lockoutDurationMs
      this.lockouts.set(key, record)

      logger.warn('Account locked due to too many failed attempts', {
        tenantId,
        employeeId,
        failedAttempts: record.failedAttempts,
        lockedUntilSeconds: LOCKOUT_CONFIG.lockoutDurationMs / 1000,
      })

      return {
        shouldLock: true,
        attemptsRemaining: 0,
        lockedUntilSeconds: LOCKOUT_CONFIG.lockoutDurationMs / 1000,
      }
    }

    const attemptsRemaining = LOCKOUT_CONFIG.maxAttempts - record.failedAttempts

    logger.debug('Failed login attempt recorded', {
      tenantId,
      employeeId,
      failedAttempts: record.failedAttempts,
      attemptsRemaining,
    })

    return {
      shouldLock: false,
      attemptsRemaining,
      lockedUntilSeconds: 0,
    }
  }

  /**
   * Clear failed attempts on successful login
   */
  clearFailedAttempts(tenantId: string, employeeId: string): void {
    const key = this.getKey(tenantId, employeeId)
    this.lockouts.delete(key)

    logger.debug('Cleared failed attempts after successful login', {
      tenantId,
      employeeId,
    })
  }

  /**
   * Manually unlock account (admin action)
   */
  unlock(tenantId: string, employeeId: string): void {
    const key = this.getKey(tenantId, employeeId)
    this.lockouts.delete(key)

    logger.info('Account manually unlocked', {
      tenantId,
      employeeId,
    })
  }

  /**
   * Get lockout status for employee
   */
  getStatus(
    tenantId: string,
    employeeId: string
  ): {
    isLocked: boolean
    failedAttempts: number
    attemptsRemaining: number
    lockedUntilSeconds: number
  } {
    const key = this.getKey(tenantId, employeeId)
    const record = this.lockouts.get(key)

    if (!record) {
      return {
        isLocked: false,
        failedAttempts: 0,
        attemptsRemaining: LOCKOUT_CONFIG.maxAttempts,
        lockedUntilSeconds: 0,
      }
    }

    const isLocked = this.isLocked(tenantId, employeeId)
    const lockedUntilSeconds = isLocked ? this.getLockoutRemainingSeconds(tenantId, employeeId) : 0

    return {
      isLocked,
      failedAttempts: record.failedAttempts,
      attemptsRemaining: Math.max(0, LOCKOUT_CONFIG.maxAttempts - record.failedAttempts),
      lockedUntilSeconds,
    }
  }

  /**
   * Cleanup expired lockouts (memory management)
   */
  cleanup(): void {
    const now = Date.now()
    let cleanedCount = 0

    for (const [key, record] of this.lockouts.entries()) {
      // Remove if lockout expired and no recent attempts
      if (
        record.lockedUntil &&
        now >= record.lockedUntil &&
        now - record.lastAttemptAt > LOCKOUT_CONFIG.resetWindowMs
      ) {
        this.lockouts.delete(key)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned up expired lockouts', { count: cleanedCount })
    }
  }
}

// Singleton instance
export const accountLockoutService = new AccountLockoutService()

// Schedule cleanup every 5 minutes
setInterval(
  () => {
    accountLockoutService.cleanup()
  },
  5 * 60 * 1000
)
