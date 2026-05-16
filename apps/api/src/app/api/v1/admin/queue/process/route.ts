// =============================================================================
// apps/api/src/app/api/v1/admin/queue/process/route.ts
//
// POST /api/v1/admin/queue/process
//
// Called by Vercel Cron (every minute) to drain the job queues.
// Also callable manually by admins for debugging.
//
// Security: protected by CRON_SECRET header (set in vercel.json).
// =============================================================================

import { NextRequest } from "next/server";
import { runWorker } from "../../../../../../../../../../lib/queue";

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Allow in dev without secret
    return process.env.NODE_ENV === "development";
  }
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({})) as { batchSize?: number };
  const batchSize = Math.min(body.batchSize ?? 5, 20);

  // Run both queues in parallel
  const [deployResult, aiResult] = await Promise.all([
    runWorker("deploy", batchSize),
    runWorker("ai_generation", batchSize),
  ]);

  return new Response(
    JSON.stringify({
      ok: true,
      results: {
        deploy: deployResult,
        ai_generation: aiResult,
      },
      processedAt: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// Also support GET for Vercel Cron (which sends GET by default)
export async function GET(req: NextRequest) {
  return POST(req);
}
