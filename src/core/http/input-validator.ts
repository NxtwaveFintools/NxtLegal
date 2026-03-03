/**
 * Input validation utilities
 * Prevents injection attacks and validates business rules
 */

import { z } from 'zod'
import { appConfig } from '@/core/config/app-config'
import { isAllowedEmailDomain } from '@/core/config/allowed-domains'

/**
 * Login email validation
 */
export const LoginEmailSchema = z
  .string()
  .email('Invalid email address')
  .toLowerCase()
  .transform((value) => value.trim())
  .refine((value) => isAllowedEmailDomain(value, appConfig.auth.allowedDomains), {
    message: `Only ${appConfig.auth.allowedDomains.map((domain) => `@${domain}`).join(', ')} email addresses are allowed`,
  })

/**
 * Validate and normalize login email
 */
export function validateLoginEmail(email: string): string {
  return LoginEmailSchema.parse(email)
}

/**
 * Tenant ID validation (UUID v4)
 */
export const TenantIdSchema = z.string().uuid('Invalid tenant ID format')

/**
 * Validate tenant ID format
 */
export function validateTenantId(tenantId: string): string {
  return TenantIdSchema.parse(tenantId.trim())
}

/**
 * Email validation with normalization
 */
export const EmailSchema = z
  .string()
  .email('Invalid email address')
  .toLowerCase()
  .transform((email) => email.trim())

/**
 * Validate and normalize email
 */
export function validateEmail(email: string): string {
  return EmailSchema.parse(email)
}

/**
 * Correlation ID validation (UUID v4)
 */
export const CorrelationIdSchema = z.string().uuid('Invalid correlation ID format')

/**
 * Role validation
 */
export const RoleSchema = z.enum(['POC', 'HOD', 'LEGAL_TEAM', 'ADMIN'], {
  errorMap: () => ({ message: 'Invalid role' }),
})

/**
 * Sanitize rate limit key to prevent injection
 * Only allows alphanumeric, hyphens, underscores, colons
 */
export function sanitizeRateLimitKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9:_-]/g, '_')
}

/**
 * Validate pagination parameters
 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
})

/**
 * Idempotency key validation
 * UUID v4 format required
 */
export const IdempotencyKeySchema = z.string().uuid('Invalid idempotency key format').min(36).max(36)

/**
 * Validate idempotency key
 */
export function validateIdempotencyKey(key: string): string {
  return IdempotencyKeySchema.parse(key.trim())
}

/**
 * IP address validation (IPv4 or IPv6)
 */
export const IpAddressSchema = z
  .string()
  .ip({ version: 'v4' })
  .or(z.string().ip({ version: 'v6' }))
  .or(z.literal('unknown')) // Allow 'unknown' when IP can't be determined

/**
 * Validate IP address
 */
export function validateIpAddress(ip: string): string {
  return IpAddressSchema.parse(ip)
}

/**
 * Safe string validation (prevents NoSQL injection, XSS)
 * Only allows printable ASCII characters, no control characters
 */
export const SafeStringSchema = z
  .string()
  .max(1000)
  .regex(/^[\x20-\x7E]*$/, 'Invalid characters detected')

/**
 * Validate metadata objects (for audit logs, etc.)
 * Ensures no prototype pollution
 */
export function validateMetadata(metadata: unknown): Record<string, unknown> {
  if (typeof metadata !== 'object' || metadata === null) {
    return {}
  }

  const safe: Record<string, unknown> = {}
  const obj = metadata as Record<string, unknown>

  // Only copy own properties, skip prototype pollution attempts
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }
    // Only allow primitive values and plain objects
    const value = obj[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      safe[key] = validateMetadata(value)
    }
  }

  return safe
}
