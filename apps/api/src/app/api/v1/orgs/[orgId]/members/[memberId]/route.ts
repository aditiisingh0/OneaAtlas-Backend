// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/members/[memberId]/route.ts
// PATCH  — update member role
// DELETE — remove member
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { updateMemberRoleSchema, NotFoundError, ForbiddenError } from "@oneatlas/shared";
import { requireOrgAdmin } from "../../../../../../lib/auth";
import { ok, noContent, errorResponse } from "../../../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

interface RouteContext {
  params: { orgId: string; memberId: string };
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgAdmin(params.orgId);
    const body = updateMemberRoleSchema.parse(await req.json());

    const member = await prisma.orgMember.findUnique({
      where: { id: params.memberId },
      include: { user: { select: { email: true } } },
    });

    if (!member || member.orgId !== params.orgId) {
      throw new NotFoundError("Member");
    }

    // Cannot change own role
    if (member.userId === auth.userId) {
      throw new ForbiddenError("You cannot change your own role.");
    }

    // Cannot change an OWNER's role (protect the owner)
    if (member.role === "OWNER") {
      throw new ForbiddenError("The organization owner's role cannot be changed.");
    }

    const updated = await prisma.orgMember.update({
      where: { id: params.memberId },
      data: { role: body.role },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      action: "org.member_role_changed",
      metadata: {
        targetUserId: member.userId,
        email: member.user.email,
        oldRole: member.role,
        newRole: body.role,
      },
    });

    return ok(updated);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgAdmin(params.orgId);

    const member = await prisma.orgMember.findUnique({
      where: { id: params.memberId },
      include: { user: { select: { email: true } } },
    });

    if (!member || member.orgId !== params.orgId) {
      throw new NotFoundError("Member");
    }

    if (member.role === "OWNER") {
      throw new ForbiddenError("The owner cannot be removed from the organization.");
    }

    // Members can remove themselves; admins can remove others
    if (member.userId !== auth.userId && auth.role !== "ADMIN" && auth.role !== "OWNER") {
      throw new ForbiddenError("You do not have permission to remove this member.");
    }

    await prisma.orgMember.delete({ where: { id: params.memberId } });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      action: "org.member_removed",
      metadata: { removedUserId: member.userId, email: member.user.email },
    });

    return noContent();
  } catch (error) {
    return errorResponse(error);
  }
}
