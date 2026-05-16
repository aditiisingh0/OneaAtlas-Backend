// =============================================================================
// apps/api/src/app/api/v1/admin/queue/route.ts
//
// GET  /api/v1/admin/queue         — queue depths + dead-letter counts
// GET  /api/v1/admin/queue?jobId=  — single job status lookup
//
// Admin-only. Requires CRON_SECRET or a future admin auth check.
// =============================================================================

import { NextRequest } from "next/server";
import { getQueueStats, getJobStatus } from "../../../../../../../../../lib/queue";

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "development";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jobId = req.nextUrl.searchParams.get("jobId");

  // Single job status lookup
  if (jobId) {
    const status = await getJobStatus(jobId);
    if (!status) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // All queue stats
  const [deploy, ai] = await Promise.all([
    getQueueStats("deploy"),
    getQueueStats("ai_generation"),
  ]);

  return new Response(
    JSON.stringify({
      queues: { deploy, ai_generation: ai },
      fetchedAt: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
