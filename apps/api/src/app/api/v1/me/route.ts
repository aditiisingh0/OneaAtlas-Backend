// =============================================================================
// apps/api/src/app/api/v1/me/route.ts
// GET  /api/v1/me  — current user profile + org memberships
// PATCH /api/v1/me — update display name / avatar
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { z } from "zod";
import { requireAuth } from "../../../../lib/auth";
import { ok, errorResponse } from "../../../../lib/response";

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

export async function GET(_req: NextRequest) {
  try {
    const { user } = await requireAuth();

    const profile = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        status: true,
        lastActiveAt: true,
        createdAt: true,
        memberships: {
          where: { acceptedAt: { not: null } },
          select: {
            role: true,
            acceptedAt: true,
            org: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                plan: true,
                status: true,
              },
            },
          },
          orderBy: { acceptedAt: "asc" },
        },
      },
    });

    // Bump lastActiveAt in the background — don't await
    prisma.user
      .update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
      .catch(() => {});

    return ok(profile);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await requireAuth();
    const body = updateProfileSchema.parse(await req.json());

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        status: true,
        updatedAt: true,
      },
    });

    return ok(updated);
  } catch (error) {
    return errorResponse(error);
  }
}
