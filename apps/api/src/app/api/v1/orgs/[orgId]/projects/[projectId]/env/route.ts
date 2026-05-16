// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/projects/[projectId]/env/route.ts
//
// GET    /env  — list env var keys (values never returned for secrets)
// POST   /env  — create or update an env var (value encrypted at rest)
// DELETE /env?key=KEY  — delete an env var
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { createAuditLog } from "@oneatlas/db";
import { projectEnvVarSchema, NotFoundError } from "@oneatlas/shared";
import { requireOrgMember } from "../../../../../../../../../../../../lib/auth";
import { ok, created, noContent, errorResponse } from "../../../../../../../../../../../../lib/response";
import { encryptEnvValue, decryptEnvValue } from "../../../../../../../../../../../../lib/secrets";
import { sanitizeString } from "../../../../../../../../../../../../lib/sanitize";

interface RouteContext {
  params: { orgId: string; projectId: string };
}

// ── GET — list env vars ───────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);

    const vars = await prisma.projectEnvVar.findMany({
      where: { projectId: params.projectId },
      select: {
        id: true,
        key: true,
        isSecret: true,
        createdAt: true,
        updatedAt: true,
        // value is intentionally omitted for secrets
      },
      orderBy: { key: "asc" },
    });

    return ok(vars);
  } catch (error) {
    return errorResponse(error);
  }
}

// ── POST — upsert env var (encrypted) ────────────────────────────────────────
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "MEMBER");
    const body = projectEnvVarSchema.parse(await req.json());

    // Sanitize key (though the Zod schema already restricts to [A-Z0-9_])
    const key = sanitizeString(body.key).toUpperCase();
    const encryptedValue = await encryptEnvValue(body.value);

    const envVar = await prisma.projectEnvVar.upsert({
      where: { projectId_key: { projectId: params.projectId, key } },
      create: {
        projectId: params.projectId,
        key,
        value: encryptedValue,
        isSecret: body.isSecret,
      },
      update: {
        value: encryptedValue,
        isSecret: body.isSecret,
      },
      select: {
        id: true,
        key: true,
        isSecret: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: params.projectId,
      action: "env_var.upserted",
      metadata: { key, isSecret: body.isSecret },
    });

    return created(envVar);
  } catch (error) {
    return errorResponse(error);
  }
}

// ── DELETE — remove env var ───────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "MEMBER");
    const key = req.nextUrl.searchParams.get("key")?.toUpperCase();

    if (!key) {
      return errorResponse(new Error("key query param is required"));
    }

    const existing = await prisma.projectEnvVar.findUnique({
      where: { projectId_key: { projectId: params.projectId, key } },
    });

    if (!existing) throw new NotFoundError("Env var");

    await prisma.projectEnvVar.delete({
      where: { projectId_key: { projectId: params.projectId, key } },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: params.projectId,
      action: "env_var.deleted",
      metadata: { key },
    });

    return noContent();
  } catch (error) {
    return errorResponse(error);
  }
}
