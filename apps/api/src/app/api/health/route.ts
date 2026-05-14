// =============================================================================
// apps/api/src/app/api/health/route.ts
// Simple health check — used by uptime monitors and load balancers.
// Returns DB connectivity status without exposing sensitive info.
// =============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@oneatlas/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();

  let dbStatus: "ok" | "error" = "ok";
  let dbLatencyMs: number | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - start;
  } catch {
    dbStatus = "error";
  }

  const healthy = dbStatus === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "0.0.1",
      services: {
        database: { status: dbStatus, latencyMs: dbLatencyMs },
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
