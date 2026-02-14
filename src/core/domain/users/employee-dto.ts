/**
 * Data Transfer Objects for Employee entities
 * Used to control what data is exposed through API responses
 * NEVER expose password_hash to API consumers
 */

import type { EmployeeRecord } from '@/core/domain/users/employee-repository'

/**
 * Public employee DTO - safe for API responses
 * Excludes sensitive fields like password hash
 */
export interface EmployeePublicDTO {
  id: string
  employeeId: string
  tenantId: string
  email: string
  fullName: string | null
  isActive: boolean
  role: string
  createdAt: string
  updatedAt: string
}

/**
 * Employee DTO for authentication context
 * Includes password hash for verification only
 * Should NEVER be returned in API responses
 */
export interface EmployeeAuthDTO extends EmployeePublicDTO {
  passwordHash: string | null | undefined
}

/**
 * Convert full EmployeeRecord to public DTO
 * Removes sensitive fields
 */
export function toPublicEmployeeDTO(employee: EmployeeRecord): EmployeePublicDTO {
  return {
    id: employee.id,
    employeeId: employee.employeeId,
    tenantId: employee.tenantId,
    email: employee.email,
    fullName: employee.fullName ?? null,
    isActive: employee.isActive,
    role: employee.role,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  }
}

/**
 * Convert full EmployeeRecord to auth DTO
 * Keeps password hash for authentication
 */
export function toAuthEmployeeDTO(employee: EmployeeRecord): EmployeeAuthDTO {
  return {
    id: employee.id,
    employeeId: employee.employeeId,
    tenantId: employee.tenantId,
    email: employee.email,
    fullName: employee.fullName ?? null,
    isActive: employee.isActive,
    role: employee.role,
    passwordHash: employee.passwordHash,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  }
}

/**
 * Employee list response - for API pagination
 */
export interface EmployeeListResponse {
  employees: EmployeePublicDTO[]
  total: number
  page: number
  pageSize: number
}
