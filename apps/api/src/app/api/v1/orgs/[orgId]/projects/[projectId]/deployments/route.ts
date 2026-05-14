// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/projects/[projectId]/deployments/route.ts
// GET  — list deployments for a project
// POST — trigger a new deployment
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import {
  createDeploymentSchema,
  NotFoundError,
  DeploymentError,
  paginationSchema,
  buildOffsetArgs,
  paginateResult,
} from "@oneatlas/shared";
import { requireOrgMember } from "../../../../../../../../../lib/auth";
import { ok, created, errorResponse } from "../../../../../../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

interface RouteContext {
  params: { orgId: string; projectId: string };
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);

    const { page, limit } = paginationSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams)
    );
    const { skip, take } = buildOffsetArgs({ page, limit });

    const [deployments, total] = await Promise.all([
      prisma.deployment.findMany({
        where: { projectId: params.projectId },
        orderBy: { version: "desc" },
        skip,
        take,
      }),
      prisma.deployment.count({ where: { projectId: params.projectId } }),
    ]);

    return ok(paginateResult(deployments, total, page, limit));
  } catch (error) {
    return errorResponse(error);
  }
}

// ── POST — trigger deploy ─────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "MEMBER");
    const body = createDeploymentSchema.parse(await req.json());

    // Verify project exists and belongs to org
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { id: true, orgId: true, status: true, generatedCode: true },
    });

    if (!project || project.orgId !== params.orgId || project.status === "DELETED") {
      throw new NotFoundError("Project");
    }

    if (!project.generatedCode) {
      throw new DeploymentError(
        "Project has no generated code yet. Run AI generation first."
      );
    }

    // Block concurrent deploys
    const inProgress = await prisma.deployment.findFirst({
      where: {
        projectId: params.projectId,
        status: { in: ["QUEUED", "BUILDING", "DEPLOYING"] },
      },
    });

    if (inProgress) {
      throw new DeploymentError(
        "A deployment is already in progress. Wait for it to complete."
      );
    }

    // Get next version number
    const lastDeployment = await prisma.deployment.findFirst({
      where: { projectId: params.projectId },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const version = (lastDeployment?.version ?? 0) + 1;

    const deployment = await prisma.deployment.create({
      data: {
        projectId: params.projectId,
        version,
        status: "QUEUED",
        env: body.env,
        triggeredBy: auth.userId,
        codeSnapshot: project.generatedCode,
      },
    });

    // TODO: Enqueue to Cloudflare Queue / BullMQ for actual build
    // await deploymentQueue.add("deploy", { deploymentId: deployment.id });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: params.projectId,
      action: "deployment.triggered",
      metadata: { deploymentId: deployment.id, version, env: body.env },
    });

    return created(deployment);
  } catch (error) {
    return errorResponse(error);
  }
}
