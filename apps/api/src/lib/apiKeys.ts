// =============================================================================
// apps/api/src/lib/apiKeys.ts
//
// Row 18 — Security: API Key Management
//
// Provides programmatic access to the OneAtlas API without Clerk sessions.
// Used by CI/CD pipelines, external integrations, and the CLI.
//
// Key format:  oa_live_{32 random bytes as hex}
//              oa_test_{32 random bytes as hex}   (for test/dev keys)
//
// Storage:
//   - Only the SHA-256 hash is stored in ApiKey.keyHash
//   - The prefix (first 12 chars) is stored in ApiKey.prefix for display
//   - The full plaintext key is shown ONCE at creation, never again
//
// Verification flow:
//   1. Client sends: Authorization: Bearer oa_live_...
//   2. We SHA-256 the incoming key → look up ApiKey by keyHash
//   3. Verify the key hasn't expired → load the associated org
//   4. Return an AuthContext identical to requireOrgMember()
// =============================================================================

import { createHash, randomBytes } from "crypto";
import { prisma } from "@oneatlas/db";
import { UnauthorizedError, ForbiddenError } from "@oneatlas/shared";
import type { AuthContext } from "./auth";

// ── Key generation ────────────────────────────────────────────────────────────

export type ApiKeyEnv = "live" | "test";

export interface GeneratedApiKey {
  /** Full plaintext key — show once, never store */
  key: string;
  /** Prefix shown in UI — safe to store */
  prefix: string;
  /** SHA-256 hash — what goes in the DB */
  keyHash: string;
}

export function generateApiKey(env: ApiKeyEnv = "live"): GeneratedApiKey {
  const raw = randomBytes(32).toString("hex");
  const key = `oa_${env}_${raw}`;
  const prefix = key.slice(0, 12); // "oa_live_XXXX"
  const keyHash = createHash("sha256").update(key).digest("hex");
  return { key, prefix, keyHash };
}

// ── Hash for lookup ───────────────────────────────────────────────────────────

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ── Verify an incoming API key ────────────────────────────────────────────────

/**
 * Resolve a raw API key string to an AuthContext.
 * Throws UnauthorizedError / ForbiddenError on failure.
 */
export async function verifyApiKey(rawKey: string): Promise<AuthContext & { orgId: string }> {
  if (!rawKey.startsWith("oa_live_") && !rawKey.startsWith("oa_test_")) {
    throw new UnauthorizedError("Invalid API key format");
  }

  const keyHash = hashApiKey(rawKey);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: {
      org: {
        select: {
          id: true,
          status: true,
          members: {
            where: { role: "OWNER" },
            take: 1,
            select: { userId: true, role: true },
          },
        },
      },
    },
  });

  if (!apiKey) throw new UnauthorizedError("Invalid API key");

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    throw new UnauthorizedError("API key has expired");
  }

  if (apiKey.org.status !== "ACTIVE") {
    throw new ForbiddenError("Organisation is not active");
  }

  // Update lastUsedAt without blocking the response
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const owner = apiKey.org.members[0];

  return {
    userId: owner?.userId ?? "api-key",
    orgId: apiKey.org.id,
    role: "OWNER", // API keys act as org owner
    clerkUserId: "api-key",
  };
}

// ── Extract Bearer token from header ─────────────────────────────────────────

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}
