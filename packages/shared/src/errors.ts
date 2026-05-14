// =============================================================================
// packages/shared/src/errors.ts
// Typed error classes for consistent error handling across the API.
// =============================================================================

import { HTTP_STATUS } from "./constants";

export type ErrorCode =
  // Auth
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "TOKEN_EXPIRED"
  // Validation
  | "VALIDATION_ERROR"
  | "INVALID_INPUT"
  // Resources
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "CONFLICT"
  // Limits
  | "PLAN_LIMIT_EXCEEDED"
  | "RATE_LIMIT_EXCEEDED"
  | "QUOTA_EXCEEDED"
  // AI
  | "AI_GENERATION_FAILED"
  | "AI_PROVIDER_ERROR"
  // Deployment
  | "DEPLOYMENT_FAILED"
  | "DEPLOYMENT_IN_PROGRESS"
  // Generic
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export interface ApiErrorShape {
  code: ErrorCode;
  message: string;
  status: number;
  details?: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(): ApiErrorShape {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
    };
  }
}

// ── Convenience constructors ──────────────────────────────────────────────────

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message, HTTP_STATUS.UNAUTHORIZED);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super("FORBIDDEN", message, HTTP_STATUS.FORBIDDEN);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super("NOT_FOUND", `${resource} not found`, HTTP_STATUS.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, HTTP_STATUS.CONFLICT);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION_ERROR", message, HTTP_STATUS.UNPROCESSABLE_ENTITY, details);
  }
}

export class PlanLimitError extends AppError {
  constructor(message: string) {
    super("PLAN_LIMIT_EXCEEDED", message, HTTP_STATUS.FORBIDDEN);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please slow down.") {
    super("RATE_LIMIT_EXCEEDED", message, HTTP_STATUS.TOO_MANY_REQUESTS);
  }
}

export class AIGenerationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("AI_GENERATION_FAILED", message, HTTP_STATUS.INTERNAL_SERVER_ERROR, details);
  }
}

export class DeploymentError extends AppError {
  constructor(message: string, details?: unknown) {
    super("DEPLOYMENT_FAILED", message, HTTP_STATUS.INTERNAL_SERVER_ERROR, details);
  }
}

export class InternalError extends AppError {
  constructor(message = "An unexpected error occurred") {
    super("INTERNAL_ERROR", message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * Check if an unknown thrown value is an AppError.
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Convert any thrown error to a safe ApiErrorShape for JSON responses.
 */
export function toApiError(error: unknown): ApiErrorShape {
  if (isAppError(error)) return error.toJSON();

  console.error("[UnhandledError]", error);

  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
    status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
  };
}
