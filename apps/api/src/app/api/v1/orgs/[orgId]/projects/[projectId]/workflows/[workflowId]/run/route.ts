// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/projects/[projectId]/workflows/[workflowId]/run/route.ts
//
// POST /workflows/:id/run — manually trigger a workflow run
// GET  /workflows/:id/run — list runs for a workflow (paginated)
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { z } from "zod";
import {
  NotFoundError,
  ForbiddenError,
  paginationSchema,
  buildOffsetArgs,
  paginateResult,
} from "@oneatlas/shared";
import { requireOrgMember } from "../../../../../../../../../../../lib/auth";
import { ok, created, errorResponse } from "../../../../../../../../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

interface RouteContext {
  params: { orgId: string; projectId: string; workflowId: string };
}

const triggerSchema = z.object({
  inputData: z.record(z.unknown()).optional(),
});

// ── GET — list runs ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);

    const { page, limit } = paginationSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams)
    );
    const { skip, take } = buildOffsetArgs({ page, limit });

    const [runs, total] = await Promise.all([
      prisma.workflowRun.findMany({
        where: { workflowId: params.workflowId },
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          status: true,
          duration: true,
          errorMessage: true,
          inputData: true,
          outputData: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true,
        },
      }),
      prisma.workflowRun.count({ where: { workflowId: params.workflowId } }),
    ]);

    return ok(paginateResult(runs, total, page, limit));
  } catch (error) {
    return errorResponse(error);
  }
}

// ── POST — trigger run ────────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "MEMBER");
    const body = triggerSchema.parse(await req.json());

    const workflow = await prisma.workflow.findUnique({
      where: { id: params.workflowId },
      select: {
        id: true,
        status: true,
        projectId: true,
        project: { select: { orgId: true } },
        definition: true,
      },
    });

    if (
      !workflow ||
      workflow.projectId !== params.projectId ||
      workflow.project.orgId !== params.orgId
    ) {
      throw new NotFoundError("Workflow");
    }

    if (workflow.status === "ARCHIVED") {
      throw new ForbiddenError("Archived workflows cannot be run.");
    }

    if (workflow.status === "PAUSED") {
      throw new ForbiddenError(
        "This workflow is paused. Activate it before running."
      );
    }

    const run = await prisma.workflowRun.create({
      data: {
        workflowId: workflow.id,
        // orgId is the denormalized column added by the schema fix
        orgId: params.orgId,
        status: "PENDING",
        inputData: body.inputData ?? {},
        startedAt: new Date(),
      },
    });

    // TODO: push run.id to your job queue (BullMQ / Cloudflare Queue)
    // await workflowQueue.add("run", { runId: run.id });

    // Increment totalRuns counter
    await prisma.workflow.update({
      where: { id: workflow.id },
      data: { totalRuns: { increment: 1 }, lastRunAt: new Date() },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: params.projectId,
      action: "workflow.run.triggered",
      metadata: { workflowId: workflow.id, runId: run.id },
    });

    return created(run);
  } catch (error) {
    return errorResponse(error);
  }
}
