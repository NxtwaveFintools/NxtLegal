import { createSession, deleteSession, getSession } from '@/core/infra/session/jwt-session-store'
import { verifyPassword } from '@/lib/auth/password'
import { limits } from '@/core/constants/limits'
import { authErrorCodes } from '@/core/constants/auth-errors'
import { isAllowedDomain } from '@/core/domain/auth/policies/domain-policy'
import type { AuthResult, LoginRequest, OAuthProfile } from '@/core/domain/auth/types'
import type { EmployeeRepository } from '@/core/domain/users/employee-repository'

/**
 * Pure domain service - no direct infrastructure imports
 * All dependencies injected via constructor
 * NOTE: tenantId must be passed to all repository methods for multi-tenant isolation
 */
export class AuthService {
  constructor(private employeeRepository: EmployeeRepository) {}

  async loginWithPassword({ employeeId, password }: LoginRequest, tenantId: string): Promise<AuthResult> {
    const trimmedId = employeeId?.trim() ?? ''
    if (!trimmedId || !password) {
      throw new Error(authErrorCodes.invalidCredentials)
    }

    if (trimmedId.length === 0 || password.length === 0 || password.length > limits.passwordMaxLength) {
      throw new Error(authErrorCodes.invalidCredentials)
    }

    const employee = await this.employeeRepository.findByEmployeeId({
      employeeId: trimmedId.toUpperCase(),
      tenantId,
    })

    if (!employee || !employee.passwordHash) {
      throw new Error(authErrorCodes.invalidCredentials)
    }

    if (!employee.isActive) {
      throw new Error(authErrorCodes.accountInactive)
    }

    const isValidPassword = await verifyPassword(password, employee.passwordHash)

    if (!isValidPassword) {
      throw new Error(authErrorCodes.invalidCredentials)
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
      throw new Error(authErrorCodes.unauthorized)
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
      throw new Error(authErrorCodes.unauthorized)
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
