// =============================================================================
// apps/api/src/lib/logger.ts
//
// Row 19 — Monitoring: Structured Logging
//
// A thin structured logger that:
//   - Always writes JSON to stdout (works with any log aggregator)
//   - Ships logs to Better Stack (Logtail) in production via HTTP ingestion
//   - Includes request context (requestId, orgId, userId) when available
//   - Has log levels: debug | info | warn | error
//   - Captures unhandled errors and ships them with stack traces
//
// Usage:
//   import { logger } from "@/lib/logger";
//   logger.info("deployment.started", { deploymentId, projectSlug });
//   logger.error("deployment.failed", { deploymentId, error });
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  userId?: string;
  orgId?: string;
  projectId?: string;
  deploymentId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  env: string;
  version: string;
  context: LogContext;
}

// ── Better Stack ingestion ────────────────────────────────────────────────────

const BETTERSTACK_URL = "https://in.logs.betterstack.com";
const BETTERSTACK_TOKEN = process.env.BETTERSTACK_SOURCE_TOKEN;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

async function shipToBetterStack(entry: LogEntry): Promise<void> {
  if (!BETTERSTACK_TOKEN || !IS_PRODUCTION) return;

  // Fire-and-forget — never let logging block the request
  fetch(BETTERSTACK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BETTERSTACK_TOKEN}`,
    },
    body: JSON.stringify(entry),
  }).catch(() => {
    // Silently ignore — logging must never crash the app
  });
}

// ── Core logger ───────────────────────────────────────────────────────────────

class Logger {
  private baseContext: LogContext = {};

  /**
   * Create a child logger with bound context fields.
   * Useful for request-scoped loggers.
   */
  child(context: LogContext): Logger {
    const child = new Logger();
    child.baseContext = { ...this.baseContext, ...context };
    return child;
  }

  private write(level: LogLevel, event: string, context: LogContext = {}): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      event,
      env: process.env.NODE_ENV ?? "development",
      version: process.env.npm_package_version ?? "0.0.1",
      context: { ...this.baseContext, ...context },
    };

    // Always write to stdout as JSON
    const line = JSON.stringify(entry);
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }

    // Ship to Better Stack in production
    shipToBetterStack(entry);
  }

  debug(event: string, context?: LogContext): void {
    if (IS_PRODUCTION) return; // skip debug in prod
    this.write("debug", event, context);
  }

  info(event: string, context?: LogContext): void {
    this.write("info", event, context);
  }

  warn(event: string, context?: LogContext): void {
    this.write("warn", event, context);
  }

  error(event: string, context?: LogContext & { error?: unknown }): void {
    const { error, ...rest } = context ?? {};

    const errorContext: LogContext = { ...rest };

    if (error instanceof Error) {
      errorContext.errorMessage = error.message;
      errorContext.errorStack = error.stack;
      errorContext.errorName = error.name;
    } else if (error !== undefined) {
      errorContext.errorRaw = String(error);
    }

    this.write("error", event, errorContext);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const logger = new Logger();

// ── Request-scoped logger factory ─────────────────────────────────────────────

/**
 * Create a logger pre-bound with request context.
 * Call this at the top of each route handler.
 *
 * Usage:
 *   const log = requestLogger(req, { orgId: params.orgId });
 *   log.info("project.created", { projectId });
 */
export function requestLogger(
  requestId: string,
  context: LogContext = {}
): Logger {
  return logger.child({ requestId, ...context });
}

// ── Unhandled error capture ───────────────────────────────────────────────────

/**
 * Wrap an async route handler to capture and log unhandled rejections.
 * Falls through to the normal errorResponse() — this just ensures logging.
 */
export function withErrorLogging<T>(
  fn: () => Promise<T>,
  context: LogContext = {}
): Promise<T> {
  return fn().catch((err) => {
    logger.error("unhandled.error", { ...context, error: err });
    throw err; // re-throw so errorResponse() still handles it
  });
}
