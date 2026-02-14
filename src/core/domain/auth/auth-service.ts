import { createSession, deleteSession, getSession } from '@/core/infra/session/jwt-session-store'
import { verifyPassword } from '@/lib/auth/password'
import { limits } from '@/core/constants/limits'
import { authErrorCodes } from '@/core/constants/auth-errors'
import { isAllowedDomain } from '@/core/domain/auth/policies/domain-policy'
import type { AuthResult, LoginRequest, OAuthProfile } from '@/core/domain/auth/types'
import type { EmployeeRepository } from '@/core/domain/users/employee-repository'
import type { Logger } from '@/core/infra/logging/types'
import { AuthenticationError, AuthorizationError, ValidationError } from '@/core/http/errors'

/**
 * Pure domain service - dependencies injected via constructor
 * Logger injected for debugging (abstraction, not direct import)
 * NOTE: tenantId must be passed to all repository methods for multi-tenant isolation
 */
export class AuthService {
  constructor(
    private employeeRepository: EmployeeRepository,
    private logger: Logger
  ) {}

  async loginWithPassword({ employeeId, password }: LoginRequest, tenantId: string): Promise<AuthResult> {
    const trimmedId = employeeId?.trim() ?? ''
    if (!trimmedId || !password) {
      throw new ValidationError('Employee ID and password are required')
    }

    if (trimmedId.length === 0 || password.length === 0 || password.length > limits.passwordMaxLength) {
      throw new ValidationError('Invalid credentials format')
    }

    const employee = await this.employeeRepository.findByEmployeeId({
      employeeId: trimmedId.toUpperCase(),
      tenantId,
    })

    if (!employee) {
      // Employee not found in this tenant - log for debugging (not exposed to user)
      this.logger.debug('Employee not found for login', { employeeId: trimmedId.toUpperCase(), tenantId })
      throw new AuthenticationError(authErrorCodes.invalidCredentials, 'Invalid credentials')
    }

    if (!employee.passwordHash) {
      // Employee exists but has no password (OAuth-only account)
      this.logger.debug('Employee has no password hash', { employeeId: trimmedId.toUpperCase(), tenantId })
      throw new AuthenticationError(authErrorCodes.invalidCredentials, 'Invalid credentials')
    }

    if (!employee.isActive) {
      this.logger.debug('Employee account inactive', { employeeId: trimmedId.toUpperCase(), tenantId })
      throw new AuthorizationError(authErrorCodes.accountInactive, 'Account is inactive')
    }

    const isValidPassword = await verifyPassword(password, employee.passwordHash)

    if (!isValidPassword) {
      throw new AuthenticationError(authErrorCodes.invalidCredentials, 'Invalid credentials')
    }

    await createSession({
      employeeId: employee.employeeId,
      email: employee.email,
      fullName: employee.fullName ?? undefined,
      role: employee.role,
      tenantId,
    })

    return {
      employee: {
        employeeId: employee.employeeId,
        email: employee.email,
        fullName: employee.fullName ?? undefined,
      },
    }
  }

  async loginWithOAuth(profile: OAuthProfile, tenantId: string): Promise<AuthResult> {
    if (!profile.email || !isAllowedDomain(profile.email)) {
      throw new AuthorizationError(authErrorCodes.unauthorized, 'Domain not allowed for this organization')
    }

    let employee = await this.employeeRepository.findByEmail({
      email: profile.email,
      tenantId,
    })

    // If employee doesn't exist, auto-create on first OAuth login
    if (!employee) {
      // Generate employee ID from email (e.g., user@example.com → USER001)
      const emailPrefix = profile.email.split('@')[0].toUpperCase()
      const employeeId = `${emailPrefix.substring(0, 4)}${Math.random().toString(36).substring(7).toUpperCase()}`

      // Generate a valid UUID for the id field
      const newId = crypto.randomUUID()

      employee = await this.employeeRepository.create({
        id: newId,
        employeeId,
        email: profile.email,
        tenantId,
        fullName: profile.name || undefined,
        isActive: true,
        role: 'viewer', // Default role for OAuth users
        passwordHash: null, // OAuth users don't need password hash
      })
    }

    if (!employee.isActive) {
      throw new AuthorizationError(authErrorCodes.accountInactive, 'Account is inactive')
    }

    await createSession({
      employeeId: employee.employeeId,
      email: employee.email,
      fullName: employee.fullName ?? undefined,
      role: employee.role,
      tenantId,
    })

    return {
      employee: {
        employeeId: employee.employeeId,
        email: employee.email,
        fullName: employee.fullName ?? undefined,
      },
    }
  }

  async logout() {
    await deleteSession()
  }

  async getSession() {
    return getSession()
  }
}
