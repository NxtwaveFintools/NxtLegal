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

export const IDEMPOTENCY_IN_PROGRESS_STATE = 'IN_PROGRESS' as const

type ClaimResult = { status: 'claimed' } | { status: 'cached'; record: IdempotencyRecord } | { status: 'in-progress' }

export interface IIdempotencyRepository {
  get(key: string, tenantId: string): Promise<IdempotencyRecord | null>
  set(record: IdempotencyRecord): Promise<void>
  tryCreate(record: IdempotencyRecord): Promise<boolean>
  delete(key: string, tenantId: string): Promise<void>
}

export class IdempotencyService {
  constructor(private idempotencyRepository: IIdempotencyRepository) {}

  private isInProgress(record: IdempotencyRecord): boolean {
    return record.responseData.__idempotency_state === IDEMPOTENCY_IN_PROGRESS_STATE
  }

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

  async claimOrGet(key: string, tenantId: string): Promise<ClaimResult> {
    const existingRecord = await this.getIfExists(key, tenantId)
    if (existingRecord) {
      if (this.isInProgress(existingRecord)) {
        return { status: 'in-progress' }
      }
      return { status: 'cached', record: existingRecord }
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const created = await this.idempotencyRepository.tryCreate({
      key,
      tenantId,
      responseData: { __idempotency_state: IDEMPOTENCY_IN_PROGRESS_STATE },
      statusCode: 409,
      expiresAt,
    })

    if (created) {
      return { status: 'claimed' }
    }

    const latest = await this.getIfExists(key, tenantId)
    if (!latest) {
      return { status: 'claimed' }
    }

    if (this.isInProgress(latest)) {
      return { status: 'in-progress' }
    }

    return { status: 'cached', record: latest }
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

  async releaseClaim(key: string, tenantId: string): Promise<void> {
    await this.idempotencyRepository.delete(key, tenantId)
  }
}
