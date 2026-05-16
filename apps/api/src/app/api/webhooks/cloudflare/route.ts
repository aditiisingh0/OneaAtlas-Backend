// =============================================================================
// apps/api/src/app/api/webhooks/cloudflare/route.ts
//
// POST /api/webhooks/cloudflare
//
// Receives deployment status callbacks from Cloudflare Workers.
// Cloudflare calls this webhook after a Worker deploy completes/fails.
//
// Security: requests are verified via HMAC-SHA256 signature using
// CLOUDFLARE_WEBHOOK_SECRET. Any unsigned request is rejected with 401.
//
// Payload shape (from CF):
// {
//   event: "worker.deployed" | "worker.failed" | "worker.deleted",
//   workerName: string,
//   accountId: string,
//   deploymentId?: string,   // CF's own deployment ID
//   error?: string,
//   timestamp: string,
// }
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { createAuditLog } from "@oneatlas/db";

// ── HMAC verification ─────────────────────────────────────────────────────────

async function verifyCloudflareSignature(
  req: NextRequest,
  rawBody: string
): Promise<boolean> {
  const secret = process.env.CLOUDFLARE_WEBHOOK_SECRET;

  // If no secret configured, skip verification in dev only
  if (!secret) {
    if (process.env.NODE_ENV === "development") return true;
    console.error("[cf-webhook] CLOUDFLARE_WEBHOOK_SECRET not set");
    return false;
  }

  const signature = req.headers.get("cf-webhook-signature") ?? "";
  const timestamp = req.headers.get("cf-webhook-timestamp") ?? "";

  if (!signature || !timestamp) return false;

  // CF signs: timestamp + "." + body
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const data = encoder.encode(`${timestamp}.${rawBody}`);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, data);
  const expectedHex = Buffer.from(signatureBuffer).toString("hex");

  // Constant-time compare
  return `sha256=${expectedHex}` === signature;
}

// ── Webhook event types ───────────────────────────────────────────────────────

interface CloudflareWebhookPayload {
  event: "worker.deployed" | "worker.failed" | "worker.deleted";
  workerName: string;
  accountId: string;
  cfDeploymentId?: string;
  error?: string;
  timestamp: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verify signature
  const isValid = await verifyCloudflareSignature(req, rawBody);
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: CloudflareWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as CloudflareWebhookPayload;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { event, workerName, cfDeploymentId, error: cfError } = payload;

  // Find the deployment by cfWorkerName
  const deployment = await prisma.deployment.findFirst({
    where: { cfWorkerName: workerName },
    orderBy: { version: "desc" },
    include: {
      project: { select: { id: true, orgId: true, subdomain: true } },
    },
  });

  if (!deployment) {
    // Unknown worker — log and ack (don't 404, CF retries on non-2xx)
    console.warn(`[cf-webhook] No deployment found for worker: ${workerName}`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Handle each event ───────────────────────────────────────────────────────

  if (event === "worker.deployed") {
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "LIVE",
        cfDeploymentId: cfDeploymentId ?? deployment.cfDeploymentId,
        deployedAt: new Date(),
      },
    });

    await createAuditLog({
      orgId: deployment.project.orgId,
      userId: "cloudflare-webhook",
      projectId: deployment.project.id,
      action: "deployment.cf_confirmed_live",
      metadata: {
        deploymentId: deployment.id,
        workerName,
        cfDeploymentId,
      },
    });
  } else if (event === "worker.failed") {
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "FAILED",
        errorMessage: cfError ?? "Cloudflare reported deployment failure",
      },
    });

    await createAuditLog({
      orgId: deployment.project.orgId,
      userId: "cloudflare-webhook",
      projectId: deployment.project.id,
      action: "deployment.cf_failed",
      metadata: {
        deploymentId: deployment.id,
        workerName,
        error: cfError,
      },
    });
  } else if (event === "worker.deleted") {
    // Only update if it's still LIVE — don't override an intentional ROLLED_BACK
    if (deployment.status === "LIVE") {
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: "FAILED",
          errorMessage: "Worker was deleted on Cloudflare",
        },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
