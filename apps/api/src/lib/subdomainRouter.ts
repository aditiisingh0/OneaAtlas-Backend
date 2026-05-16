// =============================================================================
// apps/api/src/lib/subdomainRouter.ts
//
// Subdomain routing helper used inside middleware.ts
//
// When a request arrives at {slug}.oneatlas.app the Next.js middleware
// intercepts it here and rewrites the path so Next.js routes it correctly:
//
//   {slug}.oneatlas.app/dashboard  →  /api/v1/runtime/{slug}  (config fetch)
//   {slug}.oneatlas.app/           →  /runtime/{slug}          (app shell)
//
// This keeps all generated-app traffic on the same Next.js server while
// allowing clean subdomain URLs in production.
//
// HOW TO WIRE THIS INTO middleware.ts:
// ──────────────────────────────────────────────────────────────────────────────
//   import { handleSubdomainRouting } from "./lib/subdomainRouter";
//
//   export default clerkMiddleware(async (auth, req) => {
//     const subdomainResponse = handleSubdomainRouting(req);
//     if (subdomainResponse) return subdomainResponse;
//     // ... rest of existing middleware logic
//   });
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { APP_DOMAIN } from "@oneatlas/shared";

// Subdomains that are part of the platform itself — never treated as app slugs
const PLATFORM_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "dashboard",
  "staging",
  "dev",
]);

/**
 * Detect whether the incoming request is for a generated app subdomain.
 * Returns a NextResponse rewrite if so, null otherwise.
 */
export function handleSubdomainRouting(
  req: NextRequest
): NextResponse | null {
  const hostname = req.headers.get("host") ?? "";

  // Only act on *.oneatlas.app (or *.localhost for local dev)
  const isAppDomain = hostname.endsWith(`.${APP_DOMAIN}`);
  const isLocalDev = hostname.match(/^([a-z0-9-]+)\.localhost(:\d+)?$/);

  if (!isAppDomain && !isLocalDev) return null;

  // Extract the subdomain segment
  const subdomain = isLocalDev
    ? (isLocalDev[1] ?? "")
    : hostname.replace(`.${APP_DOMAIN}`, "").split(":")[0];

  if (!subdomain || PLATFORM_SUBDOMAINS.has(subdomain)) return null;

  // Rewrite the request to the runtime shell handler
  // The runtime shell serves the generated app's HTML/JS
  const url = req.nextUrl.clone();
  const originalPath = url.pathname; // e.g. /dashboard or /users/123

  // Preserve the original path — the runtime shell will use it for client-side routing
  url.pathname = `/runtime/${subdomain}${originalPath === "/" ? "" : originalPath}`;

  return NextResponse.rewrite(url);
}

/**
 * Build the canonical deployed URL for a project subdomain.
 */
export function buildSubdomainUrl(slug: string): string {
  if (process.env.NODE_ENV === "development") {
    const port = process.env.PORT ?? "3000";
    return `http://${slug}.localhost:${port}`;
  }
  return `https://${slug}.${APP_DOMAIN}`;
}

/**
 * Extract and validate an app slug from a full hostname.
 * Returns null if the host is not a valid app subdomain.
 */
export function parseAppSubdomain(hostname: string): string | null {
  const host = hostname.split(":")[0]; // strip port

  if (host.endsWith(`.${APP_DOMAIN}`)) {
    const slug = host.slice(0, -(APP_DOMAIN.length + 1));
    if (!PLATFORM_SUBDOMAINS.has(slug) && slug.length > 0) return slug;
  }

  // Local dev: {slug}.localhost
  const localMatch = host.match(/^([a-z0-9-]+)\.localhost$/);
  if (localMatch) {
    const slug = localMatch[1];
    if (!PLATFORM_SUBDOMAINS.has(slug)) return slug;
  }

  return null;
}
