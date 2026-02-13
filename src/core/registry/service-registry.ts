/**
 * Central registry for service instantiation with proper dependency injection.
 * Wires all dependencies and exports singleton instances to be used by API routes.
 *
 * This prevents infrastructure coupling in domain services.
 */

import { AuthService } from '@/core/domain/auth/auth-service'
import { AuditLogger } from '@/core/domain/audit/audit-logger'
import { IdempotencyService } from '@/core/domain/idempotency/idempotency-service'
import { supabaseEmployeeRepository } from '@/core/infra/repositories/supabase-employee-repository'
import { supabaseAuditRepository } from '@/core/infra/repositories/supabase-audit-repository'
import { supabaseIdempotencyRepository } from '@/core/infra/repositories/supabase-idempotency-repository'
import type { EmployeeRepository } from '@/core/domain/users/employee-repository'

// Private instances - don't export directly
let authService: AuthService | null = null
let auditLogger: AuditLogger | null = null
let idempotencyService: IdempotencyService | null = null

/**
 * Get or create AuthService singleton with dependencies injected
 */
export function getAuthService(): AuthService {
  if (!authService) {
    // Wire dependencies: AuthService requires EmployeeRepository
    const employeeRepository: EmployeeRepository = supabaseEmployeeRepository
    authService = new AuthService(employeeRepository)
  }
  return authService
}

/**
 * Get or create AuditLogger singleton with dependencies injected
 */
export function getAuditLogger(): AuditLogger {
  if (!auditLogger) {
    auditLogger = new AuditLogger(supabaseAuditRepository)
  }
  return auditLogger
}

/**
 * Get or create IdempotencyService singleton with dependencies injected
 */
export function getIdempotencyService(): IdempotencyService {
  if (!idempotencyService) {
    idempotencyService = new IdempotencyService(supabaseIdempotencyRepository)
  }
  return idempotencyService
}

/**
 * Reset services (for testing)
 */
export function resetServices(): void {
  authService = null
  auditLogger = null
  idempotencyService = null
}

// Export types for use in other files
export type { EmployeeRepository } from '@/core/domain/users/employee-repository'
