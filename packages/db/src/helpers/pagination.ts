// =============================================================================
// packages/db/src/helpers/pagination.ts
// Generic cursor-based and offset pagination helpers for Prisma queries.
// =============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface CursorResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Build Prisma skip/take args from page/limit params.
 * Used for offset-based pagination (admin tables, lists).
 */
export function buildOffsetArgs(params: PaginationParams) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  return { skip, take: limit, page, limit };
}

/**
 * Wrap a Prisma query result with pagination metadata.
 */
export function paginateResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Build cursor-based pagination args for Prisma.
 * More efficient for large datasets / infinite scroll.
 */
export function buildCursorArgs(cursor?: string, limit = 20) {
  const take = Math.min(100, Math.max(1, limit));

  return {
    take: take + 1, // fetch one extra to check hasMore
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/**
 * Build a cursor-based result from a raw Prisma array.
 * Pass take+1 items; this slices and computes hasMore.
 */
export function cursorResult<T extends { id: string }>(
  items: T[],
  limit: number
): CursorResult<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return { data, nextCursor, hasMore };
}
