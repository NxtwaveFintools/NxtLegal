import { z } from 'zod'

/**
 * Cursor-based pagination for enterprise-scale data
 * Does not suffer from offset limitations when datasets grow large
 */

export const PaginationParamsSchema = z.object({
  cursor: z.string().optional().nullable(),
  limit: z.number().int().positive().max(100).default(50),
})

export type PaginationParams = z.infer<typeof PaginationParamsSchema>

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    nextCursor: string | null
    hasMore: boolean
    limit: number
  }
}

/**
 * Helper to determine if there are more items after the current batch
 * by fetching limit+1 items and slicing the result
 */
export function parsePaginatedResults<T>(
  items: T[],
  limit: number,
  getCursor: (item: T) => string
): PaginatedResponse<T> {
  const hasMore = items.length > limit
  const data = hasMore ? items.slice(0, limit) : items
  const nextCursor = hasMore ? getCursor(data[data.length - 1]) : null

  return {
    data,
    pagination: {
      nextCursor,
      hasMore,
      limit,
    },
  }
}

/**
 * Build a cursor-based query clause
 * Assumes the query is ordered by created_at DESC
 */
export function buildCursorFilter(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined
  // Cursor format: "timestamp:id"
  return cursor
}
