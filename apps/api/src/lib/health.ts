// =============================================================================
// apps/api/src/lib/health.ts
//
// Row 19 — Monitoring: Health Checks
//
// Individual service checks used by the /api/health endpoint.
// Each check returns { status, latencyMs, details? } and never throws —
// errors are caught and returned as { status: "error" }.
// =============================================================================

import { prisma } from "@oneatlas/db";
import { getRedis, getQueueStats } from "./queue";

export type CheckStatus = "ok" | "degraded" | "error";

export interface ServiceCheck {
  status: CheckStatus;
  latencyMs: number | null;
  details?: Record<string, unknown>;
}

// ── DB check ──────────────────────────────────────────────────────────────────

export async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : "unknown" },
    };
  }
}

// ── Redis / Upstash check ─────────────────────────────────────────────────────

export async function checkRedis(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const redis = getRedis();
    await redis.ping();
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : "unknown" },
    };
  }
}

// ── Queue depths check ────────────────────────────────────────────────────────

const DEAD_LETTER_WARN_THRESHOLD = 10;

export async function checkQueues(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const [deploy, ai] = await Promise.all([
      getQueueStats("deploy"),
      getQueueStats("ai_generation"),
    ]);

    const totalDead = deploy.dead + ai.dead;
    const status: CheckStatus =
      totalDead >= DEAD_LETTER_WARN_THRESHOLD ? "degraded" : "ok";

    return {
      status,
      latencyMs: Date.now() - start,
      details: { deploy, ai_generation: ai, totalDead },
    };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : "unknown" },
    };
  }
}

// ── Cloudflare API reachability check ─────────────────────────────────────────

export async function checkCloudflare(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      return { status: "degraded", latencyMs: null, details: { reason: "CF token not configured" } };
    }

    const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });

    const ok = res.status === 200;
    return {
      status: ok ? "ok" : "degraded",
      latencyMs: Date.now() - start,
      details: { httpStatus: res.status },
    };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : "unknown" },
    };
  }
}

// ── Aggregate health ──────────────────────────────────────────────────────────

export interface HealthReport {
  status: CheckStatus;
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: ServiceCheck;
    redis: ServiceCheck;
    queues: ServiceCheck;
    cloudflare: ServiceCheck;
  };
}

export async function getHealthReport(): Promise<HealthReport> {
  const [database, redis, queues, cloudflare] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkQueues(),
    checkCloudflare(),
  ]);

  const statuses = [database.status, redis.status, queues.status, cloudflare.status];

  const overall: CheckStatus = statuses.includes("error")
    ? "error"
    : statuses.includes("degraded")
    ? "degraded"
    : "ok";

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "0.0.1",
    uptime: process.uptime(),
    services: { database, redis, queues, cloudflare },
  };
}
