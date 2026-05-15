// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/projects/[projectId]/workflows/[workflowId]/route.ts
//
// GET    /workflows/:id      — fetch workflow + last 10 runs
// PATCH  /workflows/:id      — update definition / status (activate, pause)
// DELETE /workflows/:id      — soft-archive
// POST   /workflows/:id/run  — manually trigger a run
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { z } from "zod";
import { NotFoundError, ForbiddenError } from "@oneatlas/shared";
import { requireOrgMember } from "../../../../../../../../../../lib/auth";
import { ok, created, noContent, errorResponse } from "../../../../../../../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

interface RouteContext {
  params: { orgId: string; projectId: string; workflowId: string };
}

const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).optional(),
  definition: z
    .object({
      nodes: z.array(z.unknown()),
      edges: z.array(z.unknown()),
    })
    .optional(),
  cronExpression: z.string().optional().nullable(),
  timezone: z.string().optional(),
});

const runWorkflowSchema = z.object({
  inputData: z.record(z.unknown()).optional(),
});

// Helper — verify workflow belongs to this org+project
async function getWorkflow(params: RouteContext["params"]) {
  const wf = await prisma.workflow.findUnique({
    where: { id: params.workflowId },
    include: {
      project: { select: { orgId: true } },
    },
  });

  if (
    !wf ||
    wf.projectId !== params.projectId ||
    wf.project.orgId !== params.orgId
  ) {
    throw new NotFoundError("Workflow");
  }
  return wf;
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);
    const wf = await getWorkflow(params);

    const runs = await prisma.workflowRun.findMany({
      where: { workflowId: wf.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        duration: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    });

    const { project: _p, ...rest } = wf;
    return ok({ ...rest, recentRuns: runs });
  } catch (error) {
    return errorResponse(error);
  }
}

// ── PATCH — update / activate / pause ────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "MEMBER");
    const wf = await getWorkflow(params);

    if (wf.status === "ARCHIVED") {
      throw new ForbiddenError("Archived workflows cannot be modified. Restore them first.");
    }

    const body = updateWorkflowSchema.parse(await req.json());

    const updated = await prisma.workflow.update({
      where: { id: wf.id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.definition !== undefined && { definition: body.definition }),
        ...(body.cronExpression !== undefined && {
          cronExpression: body.cronExpression,
        }),
        ...(body.timezone !== undefined && { timezone: body.timezone }),
      },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: params.projectId,
      action: "workflow.updated",
      metadata: {
        workflowId: wf.id,
        changes: Object.keys(body),
        newStatus: body.status,
      },
    });

    return ok(updated);
  } catch (error) {
    return errorResponse(error);
  }
}

// ── DELETE — soft archive ─────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "ADMIN");
    const wf = await getWorkflow(params);

    await prisma.workflow.update({
      where: { id: wf.id },
      data: { status: "ARCHIVED" },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: params.projectId,
      action: "workflow.archived",
      metadata: { workflowId: wf.id, name: wf.name },
    });

    return noContent();
  } catch (error) {
    return errorResponse(error);
  }
}

// ── POST /run — manual trigger ────────────────────────────────────────────────
// This sub-action lives here because Next.js App Router doesn't support nested
// action segments on the same dynamic route file. Use a distinct fetch to
// `POST /workflows/:id/run` which is handled by the companion `run/route.ts`.
// This export is intentionally absent from this file — see run/route.ts.
