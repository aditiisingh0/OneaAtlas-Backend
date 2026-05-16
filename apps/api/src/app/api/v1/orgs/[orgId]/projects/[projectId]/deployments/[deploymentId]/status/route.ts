// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/projects/[projectId]/deployments/[deploymentId]/status/route.ts
//
// GET /deployments/:id/status
//
// Lightweight polling endpoint the frontend calls every few seconds while a
// deployment is in progress. Returns status + buildLog + deployedUrl only.
// Does NOT re-run the deploy — purely a read.
//
// Also triggers a Cloudflare status sync if the deployment has been stuck in
// BUILDING/DEPLOYING for more than 5 minutes (safety net for lost jobs).
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { NotFoundError } from "@oneatlas/shared";
import { requireOrgMember } from "../../../../../../../../../../../../lib/auth";
import { ok, errorResponse } from "../../../../../../../../../../../../lib/response";
import { syncDeployStatus } from "../../../../../../../../../../../../lib/deploymentService";

interface RouteContext {
  params: { orgId: string; projectId: string; deploymentId: string };
}

const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);

    const deployment = await prisma.deployment.findUnique({
      where: { id: params.deploymentId },
      select: {
        id: true,
        status: true,
        version: true,
        env: true,
        deployedUrl: true,
        deployedAt: true,
        buildLog: true,
        buildDuration: true,
        errorMessage: true,
        cfWorkerName: true,
        updatedAt: true,
        project: { select: { orgId: true } },
      },
    });

    if (!deployment || deployment.project.orgId !== params.orgId) {
      throw new NotFoundError("Deployment");
    }

    // Safety net: if stuck in an active state for too long, sync with CF
    const isActive = ["BUILDING", "DEPLOYING"].includes(deployment.status);
    const ageMs = Date.now() - new Date(deployment.updatedAt).getTime();

    if (isActive && ageMs > STUCK_THRESHOLD_MS) {
      // Fire-and-forget — don't block the response
      syncDeployStatus(deployment.id).catch((err) => {
        console.error("[status] syncDeployStatus failed:", err);
      });
    }

    const { project: _p, ...rest } = deployment;

    return ok({
      ...rest,
      // Convenience flag for the frontend poller
      isTerminal: ["LIVE", "FAILED", "ROLLED_BACK"].includes(deployment.status),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
