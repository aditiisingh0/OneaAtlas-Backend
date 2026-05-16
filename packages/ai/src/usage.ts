// =============================================================================
// packages/ai/src/usage.ts
//
// Row 20 — AI Gateway: Token Usage Tracker
//
// Writes per-completion usage records to Upstash Redis.
// Stored as a Redis list so the admin panel / billing can aggregate.
//
// Key: ai:usage:<orgId>  (list, LPUSH, capped at 10 000 entries)
// Key: ai:usage:global   (list, for platform-wide cost dashboards)
//
// Cost estimation is included so you can alert before bills spike.
// =============================================================================

import { Redis } from "@upstash/redis";
import type { UsageRecord } from "./types";
import { estimateCostCents } from "./models";

const MAX_LIST_LEN = 10_000;

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  try {
    if (_redis) return _redis;
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist a usage record after every non-cached completion.
 * Fire-and-forget — never awaited in the hot path.
 */
export async function trackUsage(record: UsageRecord): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const costCents = estimateCostCents(
    record.model,
    record.promptTokens,
    record.completionTokens,
  );

  const entry = JSON.stringify({ ...record, costCents });

  try {
    const pipe = redis.pipeline();
    pipe.lpush("ai:usage:global", entry);
    pipe.ltrim("ai:usage:global", 0, MAX_LIST_LEN - 1);

    if (record.orgId) {
      pipe.lpush(`ai:usage:${record.orgId}`, entry);
      pipe.ltrim(`ai:usage:${record.orgId}`, 0, MAX_LIST_LEN - 1);
    }

    await pipe.exec();
  } catch {
    // Swallow — usage tracking must never break generation
  }
}

/**
 * Fetch recent usage records for an org (newest first).
 * Returns up to `limit` entries, parsed from JSON.
 */
export async function getOrgUsage(
  orgId: string,
  limit = 100,
): Promise<(UsageRecord & { costCents: number })[]> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    const raw = await redis.lrange(`ai:usage:${orgId}`, 0, limit - 1);
    return raw
      .map((r) => {
        try { return JSON.parse(r as string); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Aggregate token & cost totals for an org (last N records).
 */
export async function getOrgUsageSummary(
  orgId: string,
  limit = 1_000,
): Promise<{
  totalTokens: number;
  totalCostCents: number;
  totalCalls: number;
  cachedCalls: number;
}> {
  const records = await getOrgUsage(orgId, limit);

  return records.reduce(
    (acc, r) => ({
      totalTokens:    acc.totalTokens    + r.totalTokens,
      totalCostCents: acc.totalCostCents + r.costCents,
      totalCalls:     acc.totalCalls     + 1,
      cachedCalls:    acc.cachedCalls    + (r.cached ? 1 : 0),
    }),
    { totalTokens: 0, totalCostCents: 0, totalCalls: 0, cachedCalls: 0 },
  );
}
