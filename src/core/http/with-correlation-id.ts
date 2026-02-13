import { v4 as uuidv4 } from 'uuid'
import type { NextRequest } from 'next/server'

/**
 * Proxy that attaches correlation ID to requests for tracing
 * Generates UUID or uses X-Correlation-ID header if provided
 */
export function withCorrelationId<T extends NextRequest>(
  handler: (req: T, correlationId: string, ...args: unknown[]) => Promise<Response>
) {
  return async (req: T, ...args: unknown[]): Promise<Response> => {
    const correlationId = req.headers.get('X-Correlation-ID') || uuidv4()

    // Store correlation ID in request for logging
    ;(req as unknown as Record<string, unknown>).correlationId = correlationId

    try {
      const response = await handler(req, correlationId, ...args)

      // Add correlation ID to response headers
      const newResponse = new Response(response.body, response)
      newResponse.headers.set('X-Correlation-ID', correlationId)

      return newResponse
    } catch {
      // Even on error, return correlation ID
      const response = new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
      })
      return response
    }
  }
}

/**
 * Extract correlation ID from request context
 */
export function getCorrelationId(req: NextRequest): string | undefined {
  return (req as unknown as Record<string, unknown>).correlationId as string | undefined
}
