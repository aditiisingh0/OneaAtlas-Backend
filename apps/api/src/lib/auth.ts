// =============================================================================
// apps/api/src/lib/auth.ts
// Auth helpers — resolve Clerk session → DB user + org membership.
// Use requireAuth() at the top of every protected route handler.
// =============================================================================

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@oneatlas/db";
import { UnauthorizedError, ForbiddenError, NotFoundError } from "@oneatlas/shared";
import type { UserRole } from "@oneatlas/db";

export interface AuthContext {
  userId: string;
  orgId: string;
  role: UserRole;
  clerkUserId: string;
}

/**
 * Resolve the current session and load the DB user.
 * Throws UnauthorizedError if no valid session.
 */
export async function requireAuth() {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    throw new UnauthorizedError("No valid session found");
  }

  const user = await prisma.user.findUnique({
    where: { clerkId: clerkUserId },
    select: { id: true, status: true, email: true },
  });

  if (!user) {
    throw new UnauthorizedError("User not found. Please complete onboarding.");
  }

  if (user.status === "SUSPENDED") {
    throw new ForbiddenError("Your account has been suspended. Contact support.");
  }

  return { user, clerkUserId };
}

/**
 * Resolve auth + verify the user is a member of the given org.
 * Throws ForbiddenError if not a member.
 * Optionally require a minimum role level.
 */
export async function requireOrgMember(
  orgId: string,
  minimumRole?: UserRole
) {
  const { user, clerkUserId } = await requireAuth();

  const membership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId: user.id } },
    select: { role: true },
  });

  if (!membership) {
    throw new ForbiddenError("You are not a member of this organization");
  }

  if (minimumRole && !hasMinimumRole(membership.role, minimumRole)) {
    throw new ForbiddenError(
      `This action requires ${minimumRole} role or higher`
    );
  }

  return {
    userId: user.id,
    orgId,
    role: membership.role,
    clerkUserId,
  } satisfies AuthContext;
}

/**
 * Require the user to be an OWNER or ADMIN of an org.
 */
export async function requireOrgAdmin(orgId: string) {
  return requireOrgMember(orgId, "ADMIN");
}

/**
 * Require the user to be the OWNER of an org.
 */
export async function requireOrgOwner(orgId: string) {
  return requireOrgMember(orgId, "OWNER");
}

// ── Role hierarchy ────────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<UserRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};

export function hasMinimumRole(
  actual: UserRole,
  required: UserRole
): boolean {
  return ROLE_HIERARCHY[actual] >= ROLE_HIERARCHY[required];
}
