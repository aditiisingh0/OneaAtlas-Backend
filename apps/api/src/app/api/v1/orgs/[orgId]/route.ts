// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/route.ts
// GET   /api/v1/orgs/:orgId  — get org details
// PATCH /api/v1/orgs/:orgId  — update org
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { updateOrgSchema, NotFoundError } from "@oneatlas/shared";
import { requireOrgMember, requireOrgAdmin } from "../../../../lib/auth";
import { ok, errorResponse } from "../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

interface RouteContext {
  params: { orgId: string };
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);

    const org = await prisma.organization.findUnique({
      where: { id: params.orgId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { projects: true, integrations: true },
        },
      },
    });

    if (!org) throw new NotFoundError("Organization");

    return ok(org);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgAdmin(params.orgId);
    const body = updateOrgSchema.parse(await req.json());

    const updated = await prisma.organization.update({
      where: { id: params.orgId },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl }),
      },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      action: "org.updated",
      metadata: body,
    });

    return ok(updated);
  } catch (error) {
    return errorResponse(error);
  }
}
