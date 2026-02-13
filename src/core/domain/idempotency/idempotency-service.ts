/**
 * Domain-layer idempotency service
 * Prevents duplicate operations on POST endpoints
 */

export type IdempotencyRecord = {
  id?: string
  key: string
  tenantId: string
  responseData: Record<string, unknown>
  statusCode: number
  expiresAt: string
  createdAt?: string
}

export interface IIdempotencyRepository {
  get(key: string, tenantId: string): Promise<IdempotencyRecord | null>
  set(record: IdempotencyRecord): Promise<void>
  delete(key: string, tenantId: string): Promise<void>
}

export class IdempotencyService {
  constructor(private idempotencyRepository: IIdempotencyRepository) {}

  /**
   * Check if an idempotency key has been seen before
   * Returns cached response if exists and not expired
   */
  async getIfExists(key: string, tenantId: string): Promise<IdempotencyRecord | null> {
    const record = await this.idempotencyRepository.get(key, tenantId)

    if (!record) {
      return null
    }

    // Check if record has expired
    const expiresAt = new Date(record.expiresAt).getTime()
    if (expiresAt < Date.now()) {
      // Record expired, delete and return null
      await this.idempotencyRepository.delete(key, tenantId)
      return null
    }

    return record
  }

  /**
   * Store successful operation response for idempotency
   * @param key Idempotency key from client
   * @param tenantId Tenant ID for scoping
   * @param responseData Response to cache
   * @param statusCode HTTP status code
   */
  async store(key: string, tenantId: string, responseData: Record<string, unknown>, statusCode: number): Promise<void> {
    // Cache for 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    await this.idempotencyRepository.set({
      key,
      tenantId,
      responseData,
      statusCode,
      expiresAt,
    })
  }
}
