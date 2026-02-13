/**
 * Unit tests for IdempotencyService
 */

import { IdempotencyService } from '@/core/domain/idempotency/idempotency-service'
import type { IIdempotencyRepository } from '@/core/domain/idempotency/idempotency-service'

// Mock repository
const mockIdempotencyRepository: jest.Mocked<IIdempotencyRepository> = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
}

describe('IdempotencyService', () => {
  let idempotencyService: IdempotencyService

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    idempotencyService = new IdempotencyService(mockIdempotencyRepository)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('getIfExists', () => {
    it('should return cached response if key exists and not expired', async () => {
      const key = 'idempotency-key-123'
      const tenantId = 'tenant-001'
      const responseData = { id: 'contract-001', name: 'NDA' }
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString() // Not expired

      mockIdempotencyRepository.get.mockResolvedValue({
        key,
        tenantId,
        responseData,
        statusCode: 200,
        expiresAt,
      })

      const result = await idempotencyService.getIfExists(key, tenantId)

      expect(result).toEqual({ key, tenantId, responseData, statusCode: 200, expiresAt })
      expect(mockIdempotencyRepository.get).toHaveBeenCalledWith(key, tenantId)
      expect(mockIdempotencyRepository.delete).not.toHaveBeenCalled()
    })

    it('should return null if key does not exist', async () => {
      const key = 'nonexistent-key'
      const tenantId = 'tenant-001'

      mockIdempotencyRepository.get.mockResolvedValue(null)

      const result = await idempotencyService.getIfExists(key, tenantId)

      expect(result).toBeNull()
      expect(mockIdempotencyRepository.get).toHaveBeenCalledWith(key, tenantId)
      expect(mockIdempotencyRepository.delete).not.toHaveBeenCalled()
    })

    it('should delete and return null if record is expired', async () => {
      const key = 'expired-key'
      const tenantId = 'tenant-001'
      const expiresAt = new Date(Date.now() - 1000).toISOString() // Expired 1 second ago

      mockIdempotencyRepository.get.mockResolvedValue({
        key,
        tenantId,
        responseData: {},
        statusCode: 200,
        expiresAt,
      })

      const result = await idempotencyService.getIfExists(key, tenantId)

      expect(result).toBeNull()
      expect(mockIdempotencyRepository.delete).toHaveBeenCalledWith(key, tenantId)
    })

    it('should enforce tenant isolation - different tenant cannot access key', async () => {
      const key = 'shared-key'
      const tenantA = 'tenant-a'
      const tenantB = 'tenant-b'
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString()

      // Setup: Key exists for tenant A
      mockIdempotencyRepository.get.mockImplementation(async (k, tid) => {
        return tid === tenantA
          ? {
              key: k,
              tenantId: tid,
              responseData: { data: 'tenant-a-only' },
              statusCode: 200,
              expiresAt,
            }
          : null
      })

      // Tenant B tries to access
      const result = await idempotencyService.getIfExists(key, tenantB)

      expect(result).toBeNull()
      expect(mockIdempotencyRepository.get).toHaveBeenCalledWith(key, tenantB)
    })
  })

  describe('store', () => {
    it('should store response with 24 hour expiry', async () => {
      const key = 'new-key'
      const tenantId = 'tenant-001'
      const responseData = { id: 'contract-001' }
      const statusCode = 201

      const baseDateMs = Date.now()
      jest.setSystemTime(baseDateMs)

      await idempotencyService.store(key, tenantId, responseData, statusCode)

      expect(mockIdempotencyRepository.set).toHaveBeenCalledWith(
        expect.objectContaining({
          key,
          tenantId,
          responseData,
          statusCode,
          expiresAt: new Date(baseDateMs + 24 * 60 * 60 * 1000).toISOString(),
        })
      )
    })

    it('should store with different status codes', async () => {
      const tenantId = 'tenant-001'

      // Test 200 response
      await idempotencyService.store('key1', tenantId, { data: 'success' }, 200)
      expect(mockIdempotencyRepository.set).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200 }))

      // Test 201 response
      await idempotencyService.store('key2', tenantId, { id: 'new-id' }, 201)
      expect(mockIdempotencyRepository.set).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 201 }))

      // Test 400 response (error)
      await idempotencyService.store('key3', tenantId, { error: 'validation failed' }, 400)
      expect(mockIdempotencyRepository.set).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }))
    })

    it('should enforce tenant scoping in storage', async () => {
      const tenantA = 'tenant-a'
      const tenantB = 'tenant-b'

      // Store for tenant A
      await idempotencyService.store('key', tenantA, { data: 'a' }, 200)

      // Store for tenant B
      await idempotencyService.store('key', tenantB, { data: 'b' }, 200)

      // Verify both stored with correct tenant IDs
      expect(mockIdempotencyRepository.set).toHaveBeenNthCalledWith(1, expect.objectContaining({ tenantId: tenantA }))
      expect(mockIdempotencyRepository.set).toHaveBeenNthCalledWith(2, expect.objectContaining({ tenantId: tenantB }))
    })
  })

  describe('Idempotency workflow', () => {
    it('should provide end-to-end idempotency protection', async () => {
      const key = 'idempotency-test'
      const tenantId = 'tenant-001'
      const responseData = { id: 'result-001', success: true }
      const statusCode = 201

      // First request: key doesn't exist yet
      let result = await idempotencyService.getIfExists(key, tenantId)
      expect(result).toBeNull()

      // Store successful response
      await idempotencyService.store(key, tenantId, responseData, statusCode)

      // Setup mock for second request
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString()
      mockIdempotencyRepository.get.mockResolvedValue({
        key,
        tenantId,
        responseData,
        statusCode,
        expiresAt,
      })

      // Second request: key exists, return cached response
      result = await idempotencyService.getIfExists(key, tenantId)
      expect(result).toEqual({ key, tenantId, responseData, statusCode, expiresAt })
      expect(result?.responseData).toEqual(responseData)
      expect(result?.statusCode).toEqual(statusCode)
    })
  })
})
