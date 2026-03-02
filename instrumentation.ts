/**
 * Next.js Instrumentation
 * Runs once when the server starts (before any requests are handled)
 * Used for configuration validation and one-time setup
 */

import { logger } from '@/core/infra/logging/logger'

export async function register() {
  // Only run on server-side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { requireValidConfiguration } = await import('@/core/config/config-validator')

    try {
      logger.info('🚀 Starting NXT Legal CLM System...')

      // ✅ CRITICAL: Validate all configuration before accepting requests
      await requireValidConfiguration()

      logger.info('✅ Configuration validation passed')
      logger.info('✅ Server ready to accept requests')
    } catch (error) {
      logger.error('❌ Configuration validation failed - server cannot start', {
        error: error instanceof Error ? error.message : String(error),
      })

      // Prevent server from starting with invalid configuration
      process.exit(1)
    }
  }
}
