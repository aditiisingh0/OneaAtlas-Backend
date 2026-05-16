// =============================================================================
// apps/api/src/app/api/ready/route.ts
//
// GET /api/ready
//
// Readiness probe — returns 200 only if DB + Redis are both "ok".
// Used by load balancers, Kubernetes, and Vercel health checks to decide
// whether this instance should receive traffic.
//
// Unlike /api/health (full report), /api/ready is:
//   - Fast  — only checks the two critical dependencies
//   - Binary — 200 (ready) or 503 (not ready)
//   - Public — no auth required (added to isPublicRoute in middleware)
// =============================================================================

import { NextResponse } from "next/server";
import { checkDatabase, checkRedis } from "../../lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [db, redis] = await Promise.all([checkDatabase(), checkRedis()]);

  const ready = db.status === "ok" && redis.status === "ok";

  const body = {
    ready,
    timestamp: new Date().toISOString(),
    services: {
      database: { status: db.status, latencyMs: db.latencyMs },
      redis:    { status: redis.status, latencyMs: redis.latencyMs },
    },
  };

  return NextResponse.json(body, { status: ready ? 200 : 503 });
}
