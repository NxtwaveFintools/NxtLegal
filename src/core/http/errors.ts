/**
 * Custom error classes for standardized error handling
 * All domain/service/repository errors should extend these base classes
 */

import { authErrorCodes } from '@/core/constants/auth-errors'

/** Base application error with structured metadata */
export abstract class AppError extends Error {
  public readonly code: string
  public readonly statusCode: number
  public readonly metadata?: Record<string, unknown>
  public readonly isOperational: boolean = true // Operational vs programmer errors

  constructor(code: string, message: string, statusCode: number, metadata?: Record<string, unknown>) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode
    this.metadata = metadata
    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * Authentication errors (401)
 * Invalid credentials, expired tokens, missing auth
 */
export class AuthenticationError extends AppError {
  constructor(
    code: string = authErrorCodes.unauthorized,
    message: string = 'Authentication failed',
    metadata?: Record<string, unknown>
  ) {
    super(code, message, 401, metadata)
  }
}

/**
 * Authorization errors (403)
 * Valid authentication but insufficient permissions
 */
export class AuthorizationError extends AppError {
  constructor(code: string = 'FORBIDDEN', message: string = 'Access denied', metadata?: Record<string, unknown>) {
    super(code, message, 403, metadata)
  }
}

/**
 * Validation errors (400)
 * Invalid input data, schema validation failures
 */
export class ValidationError extends AppError {
  public readonly errors?: Array<{ field: string; message: string }>

  constructor(
    message: string = 'Validation failed',
    errors?: Array<{ field: string; message: string }>,
    metadata?: Record<string, unknown>
  ) {
    super(authErrorCodes.validationError, message, 400, metadata)
    this.errors = errors
  }
}

/**
 * Resource not found errors (404)
 * Requested entity doesn't exist
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string, metadata?: Record<string, unknown>) {
    const message = identifier ? `${resource} with identifier '${identifier}' not found` : `${resource} not found`
    super('RESOURCE_NOT_FOUND', message, 404, { resource, identifier, ...metadata })
  }
}

/**
 * Conflict errors (409)
 * Duplicate resource, state conflict
 */
export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict', metadata?: Record<string, unknown>) {
    super('RESOURCE_CONFLICT', message, 409, metadata)
  }
}

/**
 * Database errors (500)
 * Connection failures, query errors, constraint violations
 */
export class DatabaseError extends AppError {
  public readonly originalError?: Error

  constructor(
    message: string = 'Database operation failed',
    originalError?: Error,
    metadata?: Record<string, unknown>
  ) {
    super('DATABASE_ERROR', message, 500, metadata)
    this.originalError = originalError
  }
}

/**
 * External API errors (502/503)
 * Third-party service failures
 */
export class ExternalServiceError extends AppError {
  public readonly service: string
  public readonly originalError?: Error

  constructor(
    service: string,
    message: string = 'External service error',
    originalError?: Error,
    metadata?: Record<string, unknown>
  ) {
    super('EXTERNAL_SERVICE_ERROR', message, 502, { service, ...metadata })
    this.service = service
    this.originalError = originalError
  }
}

/**
 * Rate limit errors (429)
 * Too many requests
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number

  constructor(retryAfter: number = 60, message: string = 'Too many requests', metadata?: Record<string, unknown>) {
    super(authErrorCodes.rateLimitExceeded, message, 429, { retryAfter, ...metadata })
    this.retryAfter = retryAfter
  }
}

/**
 * Tenant-related errors (403)
 * Tenant mismatch, cross-tenant access attempts
 */
export class TenantError extends AppError {
  constructor(message: string = 'Tenant validation failed', metadata?: Record<string, unknown>) {
    super('TENANT_ERROR', message, 403, metadata)
  }
}

/**
 * Business logic errors (422)
 * Valid request but violates business rules
 */
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(code, message, 422, metadata)
  }
}

/**
 * Type guard to check if error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * Extract HTTP status code from any error
 */
export function getErrorStatusCode(error: unknown): number {
  if (isAppError(error)) {
    return error.statusCode
  }
  return 500 // Default to internal server error
}

/**
 * Extract error code from any error
 */
export function getErrorCode(error: unknown): string {
  if (isAppError(error)) {
    return error.code
  }
  if (error instanceof Error) {
    return 'INTERNAL_ERROR'
  }
  return 'UNKNOWN_ERROR'
}

/**
 * Extract error message from any error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unknown error occurred'
}
