// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/members/route.ts
// GET    — list members
// POST   — invite member by email
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import {
  inviteMemberSchema,
  ConflictError,
  NotFoundError,
  PlanLimitError,
} from "@oneatlas/shared";
import { requireOrgAdmin, requireOrgMember } from "../../../../../lib/auth";
import { ok, created, errorResponse } from "../../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

interface RouteContext {
  params: { orgId: string };
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);

    const members = await prisma.orgMember.findMany({
      where: { orgId: params.orgId },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true, lastActiveAt: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return ok(members);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgAdmin(params.orgId);
    const body = inviteMemberSchema.parse(await req.json());

    // Check member limit
    const [org, memberCount] = await Promise.all([
      prisma.organization.findUniqueOrThrow({
        where: { id: params.orgId },
        select: { maxMembers: true, name: true },
      }),
      prisma.orgMember.count({ where: { orgId: params.orgId } }),
    ]);

    if (org.maxMembers !== -1 && memberCount >= org.maxMembers) {
      throw new PlanLimitError(
        `Your plan allows a maximum of ${org.maxMembers} members.`
      );
    }

    // Find user by email
    const invitee = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, email: true, name: true },
    });

    if (!invitee) {
      throw new NotFoundError(
        `No user found with email ${body.email}. They must sign up first.`
      );
    }

    // Check not already a member
    const existing = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: params.orgId, userId: invitee.id } },
    });

    if (existing) {
      throw new ConflictError(
        `${body.email} is already a member of this organization.`
      );
    }

    const member = await prisma.orgMember.create({
      data: {
        orgId: params.orgId,
        userId: invitee.id,
        role: body.role,
        acceptedAt: new Date(), // Auto-accept for now; add email invite flow later
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      action: "org.member_invited",
      metadata: { inviteeEmail: body.email, role: body.role },
    });

    return created(member);
  } catch (error) {
    return errorResponse(error);
  }
}
