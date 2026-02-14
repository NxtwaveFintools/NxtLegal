/**
 * Tenant constants for multi-tenant isolation
 *
 * IMPORTANT: Never hardcode tenant IDs in business logic.
 * Always reference these constants.
 */

/**
 * Default tenant ID for system operations and development
 * Used when no specific tenant is assigned
 */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000' as const

/**
 * System tenant ID for internal operations
 * Should not be used for regular user operations
 */
export const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000' as const

/**
 * Validate tenant ID format (UUID v4 or special all-zeros UUID)
 */
export function isValidTenantId(tenantId: string): boolean {
  // Accept the special all-zeros UUID (default tenant for development/testing)
  if (tenantId === DEFAULT_TENANT_ID) {
    return true
  }

  // Accept any valid UUID format (not just v4)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(tenantId)
}

/**
 * Require tenant ID or throw error
 * Use in production to enforce tenant routing
 */
export function requireTenantId(tenantId: string | null | undefined): string {
  if (!tenantId) {
    throw new Error('TENANT_ID_REQUIRED')
  }
  if (!isValidTenantId(tenantId)) {
    throw new Error('INVALID_TENANT_ID')
  }
  return tenantId
}

/**
 * Get tenant ID from header with validation
 * Falls back to default tenant in development only
 */
export function getTenantIdFromHeader(
  headerValue: string | null,
  options: { allowDefault: boolean } = { allowDefault: true }
): string {
  if (headerValue && isValidTenantId(headerValue)) {
    return headerValue
  }

  if (!options.allowDefault) {
    throw new Error('TENANT_ID_REQUIRED')
  }

  return DEFAULT_TENANT_ID
}
