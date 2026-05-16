// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/api-keys/route.ts
//
// GET  /api/v1/orgs/:orgId/api-keys   — list API keys (no secret values)
// POST /api/v1/orgs/:orgId/api-keys   — create a new API key (returns key once)
// =============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@oneatlas/db";
import { createAuditLog } from "@oneatlas/db";
import { requireOrgAdmin } from "../../../../../../../lib/auth";
import { ok, created, errorResponse } from "../../../../../../../lib/response";
import { generateApiKey } from "../../../../../../../lib/apiKeys";

interface RouteContext {
  params: { orgId: string };
}

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  env: z.enum(["live", "test"]).default("live"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// ── GET — list keys ───────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgAdmin(params.orgId);

    const keys = await prisma.apiKey.findMany({
      where: { orgId: params.orgId },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        // Never return keyHash
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(keys);
  } catch (error) {
    return errorResponse(error);
  }
}

// ── POST — create key ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgAdmin(params.orgId);
    const body = createApiKeySchema.parse(await req.json());

    const { key, prefix, keyHash } = generateApiKey(body.env);

    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 86400_000)
      : undefined;

    const apiKey = await prisma.apiKey.create({
      data: {
        orgId: params.orgId,
        name: body.name,
        keyHash,
        prefix,
        expiresAt,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      action: "api_key.created",
      metadata: { keyId: apiKey.id, name: body.name, env: body.env },
    });

    // Return the plaintext key ONCE — it cannot be retrieved again
    return created({ ...apiKey, key });
  } catch (error) {
    return errorResponse(error);
  }
}
