// =============================================================================
// apps/api/src/app/api/v1/runtime/[subdomain]/route.ts
//
// GET  /api/v1/runtime/:subdomain          — load full runtime config
// GET  /api/v1/runtime/:subdomain/ready    — lightweight readiness check
//
// These endpoints are called by:
//   - The frontend builder preview (to render the generated app)
//   - The Cloudflare edge proxy (to hydrate its routing table)
//   - Health dashboards (readiness probe)
//
// Auth: requireOrgMember is NOT used here — the runtime config endpoint is
// semi-public by design (the subdomain is already public). Sensitive data
// (env var values, secrets) is never included. The org/project must be ACTIVE.
// =============================================================================

import { NextRequest } from "next/server";
import {
  loadRuntimeConfig,
  validateRuntimeReady,
  extractSubdomain,
} from "../../../../../../../../../lib/runtime";
import { ok, errorResponse } from "../../../../../../../../../lib/response";
import { NotFoundError } from "@oneatlas/shared";

interface RouteContext {
  params: { subdomain: string };
}

// ── GET /api/v1/runtime/:subdomain ────────────────────────────────────────────
//
// Returns the full RuntimeConfig for the given subdomain.
// Used by the preview renderer and edge proxy to know the app's shape.
// -----------------------------------------------------------------------------
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const slug = extractSubdomain(params.subdomain);
    if (!slug) throw new NotFoundError("Subdomain");

    // Check if caller just wants the readiness probe
    const url = new URL(req.url);
    if (url.pathname.endsWith("/ready")) {
      const readiness = await validateRuntimeReady(slug);
      return ok(readiness, readiness.ready ? 200 : 503);
    }

    const config = await loadRuntimeConfig(slug);
    return ok(config);
  } catch (error) {
    return errorResponse(error);
  }
}
