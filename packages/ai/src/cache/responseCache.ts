// =============================================================================
// packages/ai/src/cache/responseCache.ts
//
// Row 20 — AI Gateway: Response Cache
//
// Caches AI completion responses in Upstash Redis.
// Uses the caller-supplied cacheKey (typically a hash of the prompt + model).
// Saves on token cost for identical repeated prompts (e.g. template generation).
//
// Key format: ai:cache:<cacheKey>
// =============================================================================

import { Redis } from "@upstash/redis";
import type { CompletionResponse } from "../types";

const PREFIX = "ai:cache:";

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("Upstash Redis env vars not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)");
  }
  _redis = new Redis({ url, token });
  return _redis;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attempt to read a cached response.
 * Returns null on cache miss or Redis failure (fail-open).
 */
export async function getCachedResponse(
  cacheKey: string,
): Promise<CompletionResponse | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get<CompletionResponse>(`${PREFIX}${cacheKey}`);
    return raw ?? null;
  } catch {
    // Cache read failure → treat as miss, never crash the request
    return null;
  }
}

/**
 * Store a completion response in cache.
 * Silently swallows Redis errors (fail-open).
 */
export async function setCachedResponse(
  cacheKey: string,
  response: CompletionResponse,
  ttlSeconds = 3600,
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(`${PREFIX}${cacheKey}`, response, { ex: ttlSeconds });
  } catch {
    // Cache write failure → non-fatal
  }
}

/**
 * Invalidate a specific cache entry (call when prompt changes).
 */
export async function invalidateCachedResponse(cacheKey: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(`${PREFIX}${cacheKey}`);
  } catch {
    // Swallow
  }
}
