import { routeRegistry } from '@/core/config/route-registry'
import type { ApiResponse } from '@/core/http/response'

type RequestInitOverride = Omit<RequestInit, 'body'> & { body?: unknown }

type ApiClient = {
  get: <T>(url: string, init?: RequestInitOverride) => Promise<ApiResponse<T>>
  post: <T>(url: string, body?: unknown, init?: RequestInitOverride) => Promise<ApiResponse<T>>
}

let isRefreshing = false
let refreshSubscribers: Array<(token: string) => void> = []

const subscribeTokenRefresh = (callback: (token: string) => void) => {
  refreshSubscribers.push(callback)
}

const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach((callback) => callback(token))
  refreshSubscribers = []
}

const refreshAccessToken = async (): Promise<boolean> => {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })

    if (response.ok) {
      onTokenRefreshed('refreshed')
      return true
    }

    return false
  } catch {
    return false
  }
}

const requestWithRetry = async <T>(
  url: string,
  init?: RequestInitOverride,
  retryCount = 0
): Promise<ApiResponse<T>> => {
  const maxRetries = 2

  try {
    const response = await fetch(url, {
      ...init,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      credentials: 'include', // Always send cookies
    })

    // Handle 401 Unauthorized - attempt token refresh
    if (response.status === 401 && retryCount === 0) {
      if (isRefreshing) {
        // Wait for ongoing refresh to complete
        return new Promise((resolve) => {
          subscribeTokenRefresh(() => {
            resolve(requestWithRetry<T>(url, init, retryCount + 1))
          })
        })
      }

      isRefreshing = true
      const refreshed = await refreshAccessToken()
      isRefreshing = false

      if (refreshed) {
        // Retry original request with new token
        return requestWithRetry<T>(url, init, retryCount + 1)
      }

      // Refresh failed - redirect to login
      if (typeof window !== 'undefined') {
        window.location.href = '/login?error=session_expired'
      }
    }

    // Handle 5xx errors - retry with exponential backoff
    if (response.status >= 500 && retryCount < maxRetries) {
      const delay = Math.min(1000 * 2 ** retryCount, 5000) // Max 5s delay
      await new Promise((resolve) => setTimeout(resolve, delay))
      return requestWithRetry<T>(url, init, retryCount + 1)
    }

    return response.json()
  } catch {
    // Network error - retry
    if (retryCount < maxRetries) {
      const delay = Math.min(1000 * 2 ** retryCount, 5000)
      await new Promise((resolve) => setTimeout(resolve, delay))
      return requestWithRetry<T>(url, init, retryCount + 1)
    }

    // Final failure
    return {
      ok: false,
      error: {
        code: 'network_error',
        message: 'Network request failed. Please check your connection.',
      },
    }
  }
}

export const apiClient: ApiClient = {
  get: (url, init) => requestWithRetry(url, { ...init, method: 'GET' }),
  post: (url, body, init) => requestWithRetry(url, { ...init, method: 'POST', body }),
}

export const authApiRoutes = routeRegistry.api.auth
