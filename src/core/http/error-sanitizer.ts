/**
 * Error sanitization utilities for production
 * Prevents leaking internal structure and sensitive data
 */

import type { ZodError } from 'zod'
import { appConfig } from '@/core/config/app-config'

/**
 * Sanitize Zod validation errors for production
 * - Development: Shows detailed field paths and messages
 * - Production: Shows generic validation error message
 */
export function sanitizeZodError(error: ZodError): {
  message: string
  errors?: Array<{ field: string; message: string }>
} {
  // In development, show full details
  if (appConfig.environment === 'development') {
    return {
      message: 'Validation error',
      errors: error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    }
  }

  // In production, show generic message without revealing internal structure
  return {
    message: 'Invalid request data. Please check your input and try again.',
  }
}

/**
 * Sanitize database error messages
 * Prevents leaking schema details, table names, constraint names
 */
export function sanitizeDatabaseError(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error)

  if (appConfig.environment === 'development') {
    return errorMessage
  }

  // Check for common database error patterns
  if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
    return 'This record already exists'
  }

  if (errorMessage.includes('foreign key') || errorMessage.includes('violates')) {
    return 'Invalid reference to related data'
  }

  if (errorMessage.includes('not found') || errorMessage.includes('PGRST116')) {
    return 'Resource not found'
  }

  // Generic database error for production
  return 'A database error occurred. Please try again.'
}

/**
 * Sanitize generic errors
 * Removes stack traces and internal details in production
 */
export function sanitizeError(error: unknown): string {
  if (appConfig.environment === 'development') {
    return error instanceof Error ? `${error.message}${error.stack ? `\n${error.stack}` : ''}` : String(error)
  }

  // Generic error message for production
  return 'An error occurred. Please try again or contact support if the problem persists.'
}

/**
 * Check if error should be logged with full details
 * Even in production, we log full details server-side
 */
export function shouldLogFullError(): boolean {
  return true // Always log full error details to server logs
}
