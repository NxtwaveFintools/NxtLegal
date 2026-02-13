import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { getAuthService, getIdempotencyService, getAuditLogger } from '@/core/registry/service-registry'
import { withCorrelationId } from '@/core/http/with-correlation-id'
import { LoginSchema } from '@/core/domain/auth/schemas/auth-schemas'
import { authErrorCodes, authErrorMessages } from '@/core/constants/auth-errors'
import { errorResponse, okResponse } from '@/core/http/response'
import { logger } from '@/core/infra/logging/logger'
import { rateLimiter } from '@/core/infra/rate-limiting/simple-rate-limiter'
import { limits } from '@/core/constants/limits'

const handleLogin = async (request: NextRequest, correlationId: string) => {
  try {
    // Get IP address for rate limiting
    const ip = request.headers.get('x-forwarded-for') || 'unknown'

    const body = await request.json()

    // Validate input with Zod
    const { employeeId, password } = LoginSchema.parse(body)

    // Extract tenant ID from request (from header or use default for non-SaaS)
    // In production, this should come from a routing header or subdomain
    const tenantId = request.headers.get('X-Tenant-ID') || '00000000-0000-0000-0000-000000000000'

    // Check for idempotency key - if provided, check for duplicate requests
    const idempotencyKey = request.headers.get('Idempotency-Key')
    if (idempotencyKey) {
      const idempotencyService = getIdempotencyService()
      const existingResponse = await idempotencyService.getIfExists(idempotencyKey, tenantId)
      if (existingResponse) {
        logger.info('Idempotent request detected - returning cached response', {
          correlationId,
          idempotencyKey,
          employeeId,
        })
        return NextResponse.json(existingResponse.responseData, { status: existingResponse.statusCode })
      }
    }

    // Rate limit: 5 attempts per minute per IP+email
    const rateLimitKey = `ratelimit:login:${ip}:${employeeId}`
    const { allowed, resetAfterSeconds } = rateLimiter.checkLimit(rateLimitKey, limits.maxLoginAttempts, 60)

    if (!allowed) {
      logger.warn('Login rate limit exceeded', { correlationId, ip, employeeId })
      return NextResponse.json(
        errorResponse(
          authErrorCodes.rateLimitExceeded,
          authErrorMessages[authErrorCodes.rateLimitExceeded] ?? 'Too many login attempts. Please try again later.'
        ),
        {
          status: 429,
          headers: {
            'Retry-After': String(resetAfterSeconds),
            'X-Correlation-ID': correlationId,
          },
        }
      )
    }

    const authService = getAuthService()
    const result = await authService.loginWithPassword({ employeeId, password }, tenantId)

    // Log successful login for audit trail
    const auditLogger = getAuditLogger()
    await auditLogger.logLogin(tenantId, result.employee.employeeId, 'password')

    const responseData = okResponse({ employee: result.employee })
    logger.info('User logged in successfully', { correlationId, employeeId, ip })

    // Store successful response for idempotency if key was provided
    if (idempotencyKey) {
      const idempotencyService = getIdempotencyService()
      await idempotencyService.store(idempotencyKey, tenantId, responseData, 200)
    }

    return NextResponse.json(responseData)
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      logger.warn('Login validation failed', {
        correlationId,
        error: error.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      })
      return NextResponse.json(
        errorResponse(authErrorCodes.validationError, 'Validation error', {
          errors: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
          correlationId,
        }),
        { status: 400 }
      )
    }

    // Handle auth service errors
    const errorCode = error instanceof Error ? error.message : authErrorCodes.authFailed
    const message = authErrorMessages[errorCode as keyof typeof authErrorMessages]
    const status =
      errorCode === authErrorCodes.accountInactive ? 403 : errorCode === authErrorCodes.invalidCredentials ? 401 : 500

    // Log failed login attempt for security audit
    const tenantId = request.headers.get('X-Tenant-ID') || '00000000-0000-0000-0000-000000000000'
    if (status === 401 || status === 403) {
      try {
        const auditLogger = getAuditLogger()
        // Extract employeeId from body safely for audit log
        const body = typeof request.json === 'function' ? await request.json().catch(() => ({})) : {}
        const employeeId =
          typeof body === 'object' && body !== null && 'employeeId' in body ? String(body.employeeId) : 'unknown'
        await auditLogger.logAction({
          tenantId,
          userId: employeeId,
          action: 'auth.login',
          resourceType: 'auth_session',
          resourceId: employeeId,
          metadata: { status: 'failed', reason: errorCode },
        })
      } catch (auditError) {
        logger.warn('Failed to log auth failure to audit trail', { correlationId, auditError: String(auditError) })
      }
    }

    if (status === 500) {
      logger.error('Login failed with server error', { correlationId, error: String(error), errorCode })
    }

    return NextResponse.json(
      errorResponse(errorCode, message ?? authErrorMessages[authErrorCodes.authFailed], { correlationId }),
      {
        status,
      }
    )
  }
}

export const POST = withCorrelationId(handleLogin)
