// =============================================================================
// apps/api/src/middleware.ts
// Clerk auth middleware — protects all /api/v1/* routes.
// Public routes (webhooks, health) are explicitly allowed through.
// =============================================================================

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/api/webhooks/(.*)",   // Clerk + Stripe webhooks
  "/api/health",          // Health check — no auth needed
]);

export default clerkMiddleware((auth, req) => {
  if (isPublicRoute(req)) return NextResponse.next();

  // All /api/v1/* routes require a valid Clerk session
  auth().protect();
});

export const config = {
  matcher: [
    // Match all routes except Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
