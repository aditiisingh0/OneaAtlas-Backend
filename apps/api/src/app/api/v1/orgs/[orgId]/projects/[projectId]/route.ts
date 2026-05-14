// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/projects/[projectId]/route.ts
// GET    /api/v1/orgs/:orgId/projects/:projectId
// PATCH  /api/v1/orgs/:orgId/projects/:projectId
// DELETE /api/v1/orgs/:orgId/projects/:projectId
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import {
  updateProjectSchema,
  NotFoundError,
  ForbiddenError,
} from "@oneatlas/shared";
import { requireOrgMember } from "../../../../../../../../lib/auth";
import { ok, noContent, errorResponse } from "../../../../../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

interface RouteContext {
  params: { orgId: string; projectId: string };
}

async function getProjectOrThrow(projectId: string, orgId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project || project.orgId !== orgId || project.status === "DELETED") {
    throw new NotFoundError("Project");
  }

  return project;
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        deployments: {
          orderBy: { version: "desc" },
          take: 5,
          select: {
            id: true,
            version: true,
            status: true,
            env: true,
            deployedUrl: true,
            deployedAt: true,
            buildDuration: true,
          },
        },
        workflows: {
          where: { status: { not: "ARCHIVED" } },
          select: { id: true, name: true, status: true, triggerType: true, lastRunAt: true },
        },
        envVars: {
          select: { id: true, key: true, isSecret: true, updatedAt: true },
        },
        _count: { select: { deployments: true, workflows: true } },
      },
    });

    if (!project || project.orgId !== params.orgId || project.status === "DELETED") {
      throw new NotFoundError("Project");
    }

    return ok(project);
  } catch (error) {
    return errorResponse(error);
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "MEMBER");
    const project = await getProjectOrThrow(params.projectId, params.orgId);
    const body = updateProjectSchema.parse(await req.json());

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.customDomain !== undefined && { customDomain: body.customDomain }),
      },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: project.id,
      action: "project.updated",
      metadata: body,
    });

    return ok(updated);
  } catch (error) {
    return errorResponse(error);
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "ADMIN");
    const project = await getProjectOrThrow(params.projectId, params.orgId);

    // Soft delete
    await prisma.project.update({
      where: { id: project.id },
      data: { status: "DELETED" },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: project.id,
      action: "project.deleted",
      metadata: { name: project.name },
    });

    return noContent();
  } catch (error) {
    return errorResponse(error);
  }
}
