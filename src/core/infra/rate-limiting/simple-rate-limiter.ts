/**
 * Simple in-memory rate limiter
 * In production, migrate to Redis for distributed rate limiting
 */

interface RateLimitEntry {
  attempts: number
  resetAt: number
}

class SimpleRateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map()
  private cleanupIntervalMs = 60 * 1000 // Cleanup every minute

  constructor() {
    this.setupCleanup()
  }

  /**
   * Check if request is within rate limit
   * @param key - Unique identifier for rate limit bucket (e.g., "login:ip:email")
   * @param limit - Maximum attempts allowed
   * @param windowSeconds - Time window in seconds
   * @returns { allowed, remaining, resetAfterSeconds }
   */
  checkLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): {
    allowed: boolean
    remaining: number
    resetAfterSeconds: number
  } {
    const now = Date.now()
    const entry = this.limits.get(key)

    // Initialize new entry
    if (!entry) {
      this.limits.set(key, {
        attempts: 1,
        resetAt: now + windowSeconds * 1000,
      })
      return {
        allowed: true,
        remaining: limit - 1,
        resetAfterSeconds: windowSeconds,
      }
    }

    // Entry expired, reset
    if (now >= entry.resetAt) {
      this.limits.set(key, {
        attempts: 1,
        resetAt: now + windowSeconds * 1000,
      })
      return {
        allowed: true,
        remaining: limit - 1,
        resetAfterSeconds: windowSeconds,
      }
    }

    // Still within window, increment
    entry.attempts += 1
    const allowed = entry.attempts <= limit
    const remaining = Math.max(0, limit - entry.attempts)
    const resetAfterSeconds = Math.ceil((entry.resetAt - now) / 1000)

    return {
      allowed,
      remaining,
      resetAfterSeconds,
    }
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.limits.entries()) {
      if (now >= entry.resetAt) {
        this.limits.delete(key)
      }
    }
  }

  private setupCleanup(): void {
    setInterval(() => this.cleanup(), this.cleanupIntervalMs)
  }

  /**
   * Get current state (for monitoring/debugging)
   */
  getState(): Map<string, RateLimitEntry> {
    return new Map(this.limits)
  }

  /**
   * Clear all limits (for testing)
   */
  clearAll(): void {
    this.limits.clear()
  }
}

// Singleton instance
export const rateLimiter = new SimpleRateLimiter()
