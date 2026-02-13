export type ApiError = {
  code: string
  message: string
  errors?: Array<{ field: string; message: string }>
  retryAfter?: number
  correlationId?: string
}

export type ApiResponse<T> = {
  ok: boolean
  data?: T
  error?: ApiError
}

export const okResponse = <T>(data: T): ApiResponse<T> => ({
  ok: true,
  data,
})

export const errorResponse = (
  code: string,
  message: string,
  options?: {
    errors?: Array<{ field: string; message: string }>
    retryAfter?: number
    correlationId?: string
  }
): ApiResponse<never> => ({
  ok: false,
  error: {
    code,
    message,
    ...(options?.errors && { errors: options.errors }),
    ...(options?.retryAfter && { retryAfter: options.retryAfter }),
    ...(options?.correlationId && { correlationId: options.correlationId }),
  },
})
