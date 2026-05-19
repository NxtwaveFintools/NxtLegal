/**
 * In-memory cache for revoked JWT token IDs (jti).
 * In production, this should be replaced with Redis for distributed systems.
 * Stores invalidated tokens to prevent replay attacks during token refresh.
 */

interface RevokedTokenEntry {
  revokedAt: number // Timestamp when token was revoked
  expiresAt: number // When to remove from cache (after token exp + buffer)
}

class RevokedTokensCache {
  private revokedTokens: Map<string, RevokedTokenEntry> = new Map()
  private cleanupIntervalMs = 60 * 60 * 1000 // Cleanup every hour

  constructor() {
    // Periodically cleanup expired entries
    this.setupCleanup()
  }

  /**
   * Mark a token (by jti) as revoked
   * @param jti - JWT ID to revoke
   * @param expiresAtMs - When the JWT token itself expires (in milliseconds)
   */
  revoke(jti: string, expiresAtMs: number): void {
    this.revokedTokens.set(jti, {
      revokedAt: Date.now(),
      expiresAt: expiresAtMs,
    })
  }

  /**
   * Check if a token has been revoked
   * @param jti - JWT ID to check
   * @returns true if token was revoked
   */
  isRevoked(jti: string): boolean {
    const entry = this.revokedTokens.get(jti)
    if (!entry) return false

    // Clean up if expired
    if (Date.now() > entry.expiresAt) {
      this.revokedTokens.delete(jti)
      return false
    }

    return true
  }

  /**
   * Cleanup expired entries from cache
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [jti, entry] of this.revokedTokens.entries()) {
      if (now > entry.expiresAt) {
        this.revokedTokens.delete(jti)
      }
    }
  }

  private setupCleanup(): void {
    const cleanupInterval = setInterval(() => this.cleanup(), this.cleanupIntervalMs)
    cleanupInterval.unref?.()
  }

  /**
   * Get cache size (for monitoring)
   */
  getSize(): number {
    return this.revokedTokens.size
  }

  /**
   * Clear all entries (for testing)
   */
  clearAll(): void {
    this.revokedTokens.clear()
  }
}

// Singleton instance
export const revokedTokensCache = new RevokedTokensCache()
