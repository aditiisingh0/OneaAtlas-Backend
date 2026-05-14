// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/projects/[projectId]/workflows/route.ts
// GET  — list workflows
// POST — create workflow
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import {
  createWorkflowSchema,
  paginationSchema,
  buildOffsetArgs,
  paginateResult,
  PlanLimitError,
  PLAN_LIMITS,
} from "@oneatlas/shared";
import { requireOrgMember } from "../../../../../../../../../lib/auth";
import { ok, created, errorResponse } from "../../../../../../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

interface RouteContext {
  params: { orgId: string; projectId: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);

    const { page, limit } = paginationSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams)
    );
    const { skip, take } = buildOffsetArgs({ page, limit });

    const [workflows, total] = await Promise.all([
      prisma.workflow.findMany({
        where: {
          projectId: params.projectId,
          status: { not: "ARCHIVED" },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take,
        include: {
          _count: { select: { runs: true } },
          runs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { status: true, createdAt: true, duration: true },
          },
        },
      }),
      prisma.workflow.count({
        where: { projectId: params.projectId, status: { not: "ARCHIVED" } },
      }),
    ]);

    return ok(paginateResult(workflows, total, page, limit));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "MEMBER");
    const body = createWorkflowSchema.parse(await req.json());

    // Plan limit check
    const [org, workflowCount] = await Promise.all([
      prisma.organization.findUniqueOrThrow({
        where: { id: params.orgId },
        select: { maxWorkflows: true },
      }),
      prisma.workflow.count({
        where: { projectId: params.projectId, status: { not: "ARCHIVED" } },
      }),
    ]);

    if (org.maxWorkflows !== -1 && workflowCount >= org.maxWorkflows) {
      throw new PlanLimitError(
        `Your plan allows a maximum of ${org.maxWorkflows} workflows. Upgrade to Pro for unlimited.`
      );
    }

    const workflow = await prisma.workflow.create({
      data: {
        projectId: params.projectId,
        name: body.name,
        description: body.description,
        triggerType: body.triggerType,
        cronExpression: body.cronExpression,
        timezone: body.timezone,
        definition: body.definition ?? { nodes: [], edges: [] },
        status: "DRAFT",
      },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: params.projectId,
      action: "workflow.created",
      metadata: { workflowId: workflow.id, name: workflow.name },
    });

    return created(workflow);
  } catch (error) {
    return errorResponse(error);
  }
}
