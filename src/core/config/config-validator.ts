/**
 * Configuration Validator
 * Validates all environment variables and configuration on application startup
 * MUST be called before server starts accepting requests
 */

import { envServer } from '@/core/config/env.server'
import { envPublic } from '@/core/config/env.public'
import { featureFlags } from '@/core/config/feature-flags'
import { validateContractWorkflowGraph } from '@/core/config/contract-workflow-validator'
import { limits } from '@/core/constants/limits'
import { DEFAULT_TENANT_ID } from '@/core/constants/tenants'
import { logger } from '@/core/infra/logging/logger'

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate JWT secret strength
 */
function validateJwtSecret(secret: string): { valid: boolean; error?: string } {
  if (secret.length < 32) {
    return {
      valid: false,
      error: 'JWT_SECRET_KEY must be at least 32 characters for security',
    }
  }

  // In development, allow weak secrets (but warn about it)
  if (envServer.nodeEnv === 'development') {
    return { valid: true } // Development can use any secret
  }

  // Production: Check for weak secrets
  const weakSecrets = ['secret', 'password', 'test', '123456', 'changeme', 'development']
  const lowerSecret = secret.toLowerCase()
  if (weakSecrets.some((weak) => lowerSecret.includes(weak))) {
    return {
      valid: false,
      error: 'JWT_SECRET_KEY appears to be a weak or default value (production only)',
    }
  }

  return { valid: true }
}

/**
 * Validate allowed domains format
 */
function validateAllowedDomains(domains: string): { valid: boolean; error?: string } {
  const domainList = domains.split(',').map((d) => d.trim())

  if (domainList.length === 0) {
    return {
      valid: false,
      error: 'AUTH_ALLOWED_DOMAINS must contain at least one domain',
    }
  }

  // Basic domain format validation
  const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i
  for (const domain of domainList) {
    if (!domainRegex.test(domain)) {
      return {
        valid: false,
        error: `Invalid domain format: ${domain}`,
      }
    }
  }

  return { valid: true }
}

/**
 * Validate Supabase configuration
 */
function validateSupabaseConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check URL format
  if (!envServer.supabaseUrl.startsWith('https://')) {
    errors.push('SUPABASE_URL must use HTTPS protocol')
  }

  // Check if Supabase URL is valid
  try {
    new URL(envServer.supabaseUrl)
  } catch {
    errors.push('SUPABASE_URL is not a valid URL')
  }

  // Check keys are not empty
  if (envServer.supabaseAnonKey.length < 20) {
    errors.push('SUPABASE_ANON_KEY appears to be invalid')
  }

  if (envServer.supabaseServiceRoleKey.length < 20) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY appears to be invalid')
  }

  // CRITICAL: Check service role key is not accidentally exposed to client
  if (envServer.supabaseServiceRoleKey === envServer.supabaseAnonKey) {
    errors.push('CRITICAL: Service role key must be different from anon key')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate environment-specific settings
 */
function validateEnvironmentSettings(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []
  const env = envServer.nodeEnv

  // Production-specific checks
  if (env === 'production') {
    // Feature flags should be explicit in production
    if (envServer.featureMicrosoftOAuth === 'true' && !process.env.FEATURE_MICROSOFT_OAUTH) {
      warnings.push('FEATURE_MICROSOFT_OAUTH is using default value in production')
    }
    if (envServer.featureGoogleOAuth === 'true' && !process.env.FEATURE_GOOGLE_OAUTH) {
      warnings.push('FEATURE_GOOGLE_OAUTH is using default value in production')
    }

    // Site URL should be HTTPS in production
    if (envPublic.siteUrl && !envPublic.siteUrl.startsWith('https://')) {
      warnings.push('NEXT_PUBLIC_SITE_URL should use HTTPS in production')
    }
  }

  // Development-specific checks
  if (env === 'development') {
    if (envServer.jwtSecretKey === 'development-secret-key-min-32-chars-long') {
      warnings.push('Using default JWT secret in development - acceptable for local dev')
    }
  }

  return {
    valid: true,
    warnings,
  }
}

/**
 * Validate application limits
 */
function validateLimits(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (limits.passwordMinLength < 8) {
    errors.push('passwordMinLength must be at least 8 characters')
  }

  if (limits.passwordMaxLength < limits.passwordMinLength) {
    errors.push('passwordMaxLength must be greater than passwordMinLength')
  }

  if (limits.sessionDays < 1 || limits.sessionDays > 30) {
    errors.push('sessionDays must be between 1 and 30 days')
  }

  if (limits.maxLoginAttempts < 3 || limits.maxLoginAttempts > 10) {
    errors.push('maxLoginAttempts should be between 3 and 10')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate default tenant configuration
 */
function validateTenantConfig(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []

  // Special case: Allow all-zeros UUID for default tenant (commonly used in testing/development)
  const isAllZeros = DEFAULT_TENANT_ID === '00000000-0000-0000-0000-000000000000'

  if (!isAllZeros) {
    // Verify default tenant UUID format (UUID v4)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(DEFAULT_TENANT_ID)) {
      warnings.push('DEFAULT_TENANT_ID is not a valid UUID v4 (non-standard format detected)')
    }
  }

  return {
    valid: true,
    warnings,
  }
}

/**
 * Main configuration validation function
 * Call this on application startup
 */
export async function validateConfiguration(): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  logger.info('Validating configuration...')

  // 1. Validate JWT secret
  const jwtValidation = validateJwtSecret(envServer.jwtSecretKey)
  if (!jwtValidation.valid && jwtValidation.error) {
    errors.push(jwtValidation.error)
  }

  // 2. Validate allowed domains
  const domainsValidation = validateAllowedDomains(envServer.allowedDomains)
  if (!domainsValidation.valid && domainsValidation.error) {
    errors.push(domainsValidation.error)
  }

  // 3. Validate Supabase configuration
  const supabaseValidation = validateSupabaseConfig()
  errors.push(...supabaseValidation.errors)

  // 4. Validate environment settings
  const envValidation = validateEnvironmentSettings()
  warnings.push(...envValidation.warnings)

  // 5. Validate application limits
  const limitsValidation = validateLimits()
  errors.push(...limitsValidation.errors)

  // 6. Validate tenant configuration
  const tenantValidation = validateTenantConfig()
  warnings.push(...tenantValidation.warnings)

  // 7. Validate contract workflow transition graph
  if (featureFlags.enableContractWorkflow) {
    try {
      await validateContractWorkflowGraph()
      logger.info('Contract workflow graph validation passed')
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Contract workflow graph validation failed')
    }
  }

  // Log results
  if (errors.length > 0) {
    logger.error('Configuration validation failed', { errors })
  }

  if (warnings.length > 0) {
    logger.warn('Configuration warnings', { warnings })
  }

  if (errors.length === 0 && warnings.length === 0) {
    logger.info('Configuration validation passed')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Throw error if configuration is invalid
 * Use this in server startup to prevent running with bad config
 */
export async function requireValidConfiguration(): Promise<void> {
  const result = await validateConfiguration()

  if (!result.valid) {
    const errorMessage = `Configuration validation failed:\n${result.errors.join('\n')}`
    logger.error(errorMessage)
    throw new Error(errorMessage)
  }

  if (result.warnings.length > 0) {
    logger.warn(`Configuration has ${result.warnings.length} warning(s)`, {
      warnings: result.warnings,
    })
  }
}
