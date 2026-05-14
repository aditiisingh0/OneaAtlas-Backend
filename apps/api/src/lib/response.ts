// =============================================================================
// apps/api/src/lib/response.ts
// Typed Next.js API response helpers — consistent JSON structure everywhere.
// =============================================================================

import { NextResponse } from "next/server";
import { toApiError, isAppError, HTTP_STATUS } from "@oneatlas/shared";
import { ZodError } from "zod";

// ── Success ───────────────────────────────────────────────────────────────────

export function ok<T>(data: T, status = HTTP_STATUS.OK) {
  return NextResponse.json({ success: true, data }, { status });
}

export function created<T>(data: T) {
  return NextResponse.json({ success: true, data }, { status: HTTP_STATUS.CREATED });
}

export function noContent() {
  return new NextResponse(null, { status: HTTP_STATUS.NO_CONTENT });
}

// ── Error ─────────────────────────────────────────────────────────────────────

export function errorResponse(error: unknown) {
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
          status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
          details: error.flatten().fieldErrors,
        },
      },
      { status: HTTP_STATUS.UNPROCESSABLE_ENTITY }
    );
  }

  // Handle our typed AppErrors
  if (isAppError(error)) {
    return NextResponse.json(
      { success: false, error: error.toJSON() },
      { status: error.status }
    );
  }

  // Unknown errors — don't leak internal details
  const apiError = toApiError(error);
  return NextResponse.json(
    { success: false, error: apiError },
    { status: apiError.status }
  );
}
