// =============================================================================
// apps/api/src/middleware.ts
//
// Clerk auth middleware + request logging + rate limiting enforcement.
// Replaces the original middleware.ts completely.
// =============================================================================

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { RATE_LIMITS } from "@oneatlas/shared";

// ── Route matchers ────────────────────────────────────────────────────────────

const isPublicRoute = createRouteMatcher([
  "/api/webhooks/(.*)",
  "/api/health",
]);

const isAiRoute = createRouteMatcher([
  "/api/v1/orgs/:orgId/projects/:projectId/generate",
]);

const isDeployRoute = createRouteMatcher([
  "/api/v1/orgs/:orgId/projects/:projectId/deployments",
]);

// ── Rate limiters (lazy-initialised so missing Redis just skips limiting) ─────

let defaultLimiter: Ratelimit | null = null;
let aiLimiter: Ratelimit | null = null;
let deployLimiter: Ratelimit | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

function getLimiters() {
  const redis = getRedis();
  if (!redis) return { defaultLimiter: null, aiLimiter: null, deployLimiter: null };

  if (!defaultLimiter) {
    defaultLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        RATE_LIMITS.DEFAULT.requests,
        `${RATE_LIMITS.DEFAULT.windowMs}ms`
      ),
      prefix: "rl:default",
    });
  }
  if (!aiLimiter) {
    aiLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        RATE_LIMITS.AI_GENERATE.requests,
        `${RATE_LIMITS.AI_GENERATE.windowMs}ms`
      ),
      prefix: "rl:ai",
    });
  }
  if (!deployLimiter) {
    deployLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        RATE_LIMITS.DEPLOY.requests,
        `${RATE_LIMITS.DEPLOY.windowMs}ms`
      ),
      prefix: "rl:deploy",
    });
  }

  return { defaultLimiter, aiLimiter, deployLimiter };
}

// ── Logger ────────────────────────────────────────────────────────────────────

function log(fields: Record<string, unknown>) {
  // In production, ship to BetterStack / Logtail via their SDK.
  // For now: structured JSON to stdout which any log aggregator can ingest.
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}

// ── Middleware ────────────────────────────────────────────────────────────────

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const startMs = Date.now();
  const requestId = crypto.randomUUID();

  // Attach request ID so route handlers can read it from headers
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", requestId);

  // Public routes — log and pass through
  if (isPublicRoute(req)) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("x-request-id", requestId);

    log({
      requestId,
      method: req.method,
      path: req.nextUrl.pathname,
      public: true,
      latencyMs: Date.now() - startMs,
    });

    return res;
  }

  // Require valid session for all /api/v1/* routes
  const session = await auth();
  if (!session.userId) {
    log({
      requestId,
      method: req.method,
      path: req.nextUrl.pathname,
      status: 401,
      latencyMs: Date.now() - startMs,
    });
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "No valid session", status: 401 } },
      { status: 401 }
    );
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const { defaultLimiter: dl, aiLimiter: al, deployLimiter: depl } = getLimiters();

  if (dl || al || depl) {
    // Key: per-user + per-org (extracted from path segment)
    const orgIdMatch = req.nextUrl.pathname.match(/\/orgs\/([^/]+)/);
    const orgId = orgIdMatch?.[1] ?? "global";
    const rateLimitKey = `${session.userId}:${orgId}`;

    let limiter = dl;
    if (al && isAiRoute(req))     limiter = al;
    if (depl && isDeployRoute(req)) limiter = depl;

    if (limiter) {
      const { success, limit, remaining, reset } = await limiter.limit(rateLimitKey);

      if (!success) {
        log({
          requestId,
          clerkUserId: session.userId,
          orgId,
          method: req.method,
          path: req.nextUrl.pathname,
          status: 429,
          rateLimited: true,
          latencyMs: Date.now() - startMs,
        });

        return NextResponse.json(
          {
            success: false,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Too many requests. Please slow down.",
              status: 429,
              retryAfter: Math.ceil((reset - Date.now()) / 1000),
            },
          },
          {
            status: 429,
            headers: {
              "X-RateLimit-Limit": String(limit),
              "X-RateLimit-Remaining": String(remaining),
              "X-RateLimit-Reset": String(reset),
              "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)),
            },
          }
        );
      }
    }
  }

  // ── Pass through ──────────────────────────────────────────────────────────
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("x-request-id", requestId);

  // Log after headers are set — latency includes rate-limit check
  log({
    requestId,
    clerkUserId: session.userId,
    method: req.method,
    path: req.nextUrl.pathname,
    // orgId extracted from URL if present
    orgId: req.nextUrl.pathname.match(/\/orgs\/([^/]+)/)?.[1],
    latencyMs: Date.now() - startMs,
  });

  return res;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
