// =============================================================================
// apps/api/src/app/api/v1/orgs/route.ts
// GET  /api/v1/orgs  — list orgs the current user belongs to
// POST /api/v1/orgs  — create a new organisation
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { z } from "zod";
import { RESERVED_SLUGS, SLUG_REGEX, ConflictError } from "@oneatlas/shared";
import { requireAuth } from "../../../../lib/auth";
import { ok, created, errorResponse } from "../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

const createOrgSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(SLUG_REGEX, "Slug may only contain lowercase letters, numbers, and hyphens")
    .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), {
      message: "That slug is reserved. Please choose another.",
    }),
});

// ── GET — list caller's orgs ──────────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  try {
    const { user } = await requireAuth();

    const memberships = await prisma.orgMember.findMany({
      where: { userId: user.id, acceptedAt: { not: null } },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            plan: true,
            status: true,
            createdAt: true,
            _count: { select: { projects: true, members: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return ok(memberships.map((m) => ({ role: m.role, ...m.org })));
  } catch (error) {
    return errorResponse(error);
  }
}

// ── POST — create org ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth();
    const body = createOrgSchema.parse(await req.json());

    // Slug uniqueness check
    const existing = await prisma.organization.findUnique({
      where: { slug: body.slug },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("An organisation with that slug already exists.");
    }

    const org = await prisma.$transaction(async (tx) => {
      const newOrg = await tx.organization.create({
        data: {
          name: body.name,
          slug: body.slug,
          ownerId: user.id,
        },
      });

      // Auto-add creator as OWNER
      await tx.orgMember.create({
        data: {
          orgId: newOrg.id,
          userId: user.id,
          role: "OWNER",
          acceptedAt: new Date(),
        },
      });

      return newOrg;
    });

    await createAuditLog({
      orgId: org.id,
      userId: user.id,
      action: "org.created",
      metadata: { name: org.name, slug: org.slug },
    });

    return created(org);
  } catch (error) {
    return errorResponse(error);
  }
}
