// =============================================================================
// apps/api/src/lib/deploymentService.ts
//
// Row 16 — Deployment System (orchestration layer)
//
// Sits between the API route and the Cloudflare client.
// Handles the full deploy lifecycle:
//   1. runDeployment()   — execute a QUEUED deployment end-to-end
//   2. runUndeploy()     — take a LIVE deployment offline
//   3. syncDeployStatus() — poll Cloudflare and reconcile DB status
//
// DB writes, audit logs, and error recovery all live here.
// The Cloudflare client (cloudflare.ts) stays pure — no DB access.
// =============================================================================

import { prisma } from "@oneatlas/db";
import { createAuditLog } from "@oneatlas/db";
import { DeploymentError, NotFoundError } from "@oneatlas/shared";
import {
  deployWorker,
  deleteWorker,
  addDnsRecord,
  removeDnsRecord,
  getWorkerStatus,
  buildWorkerName,
} from "./cloudflare";
import { buildSubdomainUrl } from "./subdomainRouter";
import { captureDeploymentLive } from "./analytics";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeploymentResult {
  deploymentId: string;
  status: "LIVE" | "FAILED";
  deployedUrl?: string;
  workerName?: string;
  buildDuration: number;
  error?: string;
}

// ── Worker script builder ─────────────────────────────────────────────────────

/**
 * Converts the AI-generated JSON code snapshot into a minimal Cloudflare
 * Worker script that serves the app shell + proxies API calls back to the
 * main OneAtlas API.
 *
 * In production this would compile React/Next.js. For now it emits a
 * lightweight JSON-driven SPA shell that the frontend renderer picks up.
 */
function buildWorkerScript(params: {
  projectSlug: string;
  orgSlug: string;
  codeSnapshot: Record<string, unknown>;
  apiBaseUrl: string;
}): string {
  const { projectSlug, orgSlug, codeSnapshot, apiBaseUrl } = params;

  // Serialise the generated app config so the worker can serve it inline
  const configJson = JSON.stringify({
    projectSlug,
    orgSlug,
    pages: codeSnapshot.pages ?? [],
    apiRoutes: codeSnapshot.apiRoutes ?? [],
    metadata: codeSnapshot.metadata ?? {},
    apiBase: apiBaseUrl,
  });

  return `
// OneAtlas Generated Worker — ${projectSlug}
// Auto-generated — do not edit directly

const APP_CONFIG = ${configJson};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve the runtime config as JSON (used by the frontend renderer)
    if (url.pathname === "/__config") {
      return new Response(JSON.stringify(APP_CONFIG), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    // Health probe
    if (url.pathname === "/__health") {
      return new Response(JSON.stringify({ ok: true, slug: "${projectSlug}" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Proxy all /api/* calls back to the OneAtlas API
    if (url.pathname.startsWith("/api/")) {
      const target = new URL(url.pathname + url.search, "${apiBaseUrl}");
      return fetch(target.toString(), request);
    }

    // Serve the app shell HTML — frontend renderer hydrates from /__config
    const html = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>\${APP_CONFIG.metadata?.title ?? "${projectSlug}"}</title>
  <script>window.__ONEATLAS_CONFIG__ = \${JSON.stringify(APP_CONFIG)};</script>
</head>
<body>
  <div id="root"></div>
  <script src="${
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.oneatlas.app"
  }/runtime-renderer.js"></script>
</body>
</html>\`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
`.trim();
}

// ── Core: run a deployment ────────────────────────────────────────────────────

export async function runDeployment(
  deploymentId: string,
  triggeredByUserId: string
): Promise<DeploymentResult> {
  const start = Date.now();

  // Load the deployment + project
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: {
      project: {
        select: {
          id: true,
          slug: true,
          subdomain: true,
          orgId: true,
          generatedCode: true,
          org: { select: { slug: true } },
        },
      },
    },
  });

  if (!deployment) throw new NotFoundError("Deployment");
  if (deployment.status !== "QUEUED") {
    throw new DeploymentError(
      `Deployment is ${deployment.status}, expected QUEUED`
    );
  }

  const project = deployment.project;
  const codeSnapshot = (deployment.codeSnapshot ??
    project.generatedCode ??
    {}) as Record<string, unknown>;

  // Mark as BUILDING
  await prisma.deployment.update({
    where: { id: deploymentId },
    data: { status: "BUILDING" },
  });

  let buildLog = `[${new Date().toISOString()}] Build started\n`;

  try {
    // ── Step 1: build worker script ───────────────────────────────────────
    const workerName = buildWorkerName(
      project.slug,
      deployment.env as "PREVIEW" | "PRODUCTION",
      deployment.version
    );

    buildLog += `[${new Date().toISOString()}] Worker name: ${workerName}\n`;

    const script = buildWorkerScript({
      projectSlug: project.slug,
      orgSlug: project.org.slug,
      codeSnapshot,
      apiBaseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://api.oneatlas.app",
    });

    buildLog += `[${new Date().toISOString()}] Worker script built (${script.length} bytes)\n`;

    // Mark as DEPLOYING
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: "DEPLOYING", cfWorkerName: workerName },
    });

    // ── Step 2: upload to Cloudflare Workers ─────────────────────────────
    buildLog += `[${new Date().toISOString()}] Uploading to Cloudflare Workers…\n`;

    const cfResult = await deployWorker({ workerName, script });

    buildLog += `[${new Date().toISOString()}] Worker deployed: ${cfResult.deployedUrl}\n`;

    // ── Step 3: create DNS record (production only) ───────────────────────
    let deployedUrl = cfResult.deployedUrl;

    if (deployment.env === "PRODUCTION") {
      buildLog += `[${new Date().toISOString()}] Creating DNS record for ${project.subdomain}…\n`;
      await addDnsRecord(project.subdomain, workerName);
      deployedUrl = buildSubdomainUrl(project.subdomain);
      buildLog += `[${new Date().toISOString()}] DNS record created: ${deployedUrl}\n`;
    }

    const buildDuration = Date.now() - start;
    buildLog += `[${new Date().toISOString()}] Deployment complete in ${buildDuration}ms\n`;

    // ── Step 4: mark LIVE ─────────────────────────────────────────────────
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "LIVE",
        deployedUrl,
        cfDeploymentId: cfResult.cfDeploymentId,
        cfWorkerName: workerName,
        buildLog,
        buildDuration,
        deployedAt: new Date(),
      },
    });

    await createAuditLog({
      orgId: project.orgId,
      userId: triggeredByUserId,
      projectId: project.id,
      action: "deployment.live",
      metadata: {
        deploymentId,
        workerName,
        deployedUrl,
        version: deployment.version,
        buildDurationMs: buildDuration,
      },
    });

    captureDeploymentLive({
      distinctId: triggeredByUserId,
      orgId: project.orgId,
      projectId: project.id,
      deploymentId,
      deployedUrl,
      version: deployment.version,
      env: deployment.env,
    });

    return {
      deploymentId,
      status: "LIVE",
      deployedUrl,
      workerName,
      buildDuration,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    buildLog += `[${new Date().toISOString()}] ERROR: ${errorMessage}\n`;

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "FAILED",
        buildLog,
        buildDuration: Date.now() - start,
        errorMessage,
      },
    });

    await createAuditLog({
      orgId: deployment.project.orgId,
      userId: triggeredByUserId,
      projectId: deployment.project.id,
      action: "deployment.failed",
      metadata: { deploymentId, error: errorMessage },
    });

    return {
      deploymentId,
      status: "FAILED",
      buildDuration: Date.now() - start,
      error: errorMessage,
    };
  }
}

// ── Undeploy ──────────────────────────────────────────────────────────────────

export async function runUndeploy(
  deploymentId: string,
  triggeredByUserId: string
): Promise<void> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: {
      project: { select: { id: true, orgId: true, subdomain: true } },
    },
  });

  if (!deployment) throw new NotFoundError("Deployment");
  if (deployment.status !== "LIVE") {
    throw new DeploymentError("Only LIVE deployments can be undeployed.");
  }

  // Remove Cloudflare worker
  if (deployment.cfWorkerName) {
    await deleteWorker(deployment.cfWorkerName);
  }

  // Remove DNS for production deployments
  if (deployment.env === "PRODUCTION") {
    await removeDnsRecord(deployment.project.subdomain);
  }

  await prisma.deployment.update({
    where: { id: deploymentId },
    data: {
      status: "ROLLED_BACK",
      deployedAt: null,
      deployedUrl: null,
    },
  });

  await createAuditLog({
    orgId: deployment.project.orgId,
    userId: triggeredByUserId,
    projectId: deployment.project.id,
    action: "deployment.undeployed",
    metadata: {
      deploymentId,
      workerName: deployment.cfWorkerName,
    },
  });
}

// ── Status sync ───────────────────────────────────────────────────────────────

/**
 * Poll Cloudflare for the real status of a deployment and reconcile the DB.
 * Call this from a background job or a manual admin action.
 */
export async function syncDeployStatus(deploymentId: string): Promise<void> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    select: { id: true, cfWorkerName: true, status: true },
  });

  if (!deployment?.cfWorkerName) return;

  const cfStatus = await getWorkerStatus(deployment.cfWorkerName);

  // If CF says worker is gone but DB says LIVE → mark as FAILED
  if (!cfStatus.exists && deployment.status === "LIVE") {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "FAILED",
        errorMessage: "Worker not found on Cloudflare — may have been deleted externally",
      },
    });
  }
}
