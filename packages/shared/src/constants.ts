// =============================================================================
// packages/shared/src/constants.ts
// App-wide constants shared across all packages and apps.
// =============================================================================

// ── App ───────────────────────────────────────────────────────────────────────
export const APP_NAME = "OneAtlas" as const;
export const APP_DOMAIN = "oneatlas.app" as const;
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// ── Plan Limits ────────────────────────────────────────────────────────────────
export const PLAN_LIMITS = {
  FREE: {
    maxApps: 3,
    maxWorkflows: 5,
    maxMembers: 3,
    maxStorageMb: 500,
    aiCallsPerMonth: 50,
    workflowRunsPerDay: 10,
  },
  PRO: {
    maxApps: -1,         // unlimited
    maxWorkflows: -1,    // unlimited
    maxMembers: 25,
    maxStorageMb: 10_000,
    aiCallsPerMonth: 2_000,
    workflowRunsPerDay: -1,
  },
  ENTERPRISE: {
    maxApps: -1,
    maxWorkflows: -1,
    maxMembers: -1,
    maxStorageMb: -1,
    aiCallsPerMonth: -1,
    workflowRunsPerDay: -1,
  },
} as const;

// ── AI Models ─────────────────────────────────────────────────────────────────
export const AI_MODELS = {
  // Fast/cheap — use for boilerplate, CRUD, UI
  FAST: {
    openai: "gpt-4o-mini",
    anthropic: "claude-haiku-4-5-20251001",
  },
  // Smart — use for complex generation, reasoning
  SMART: {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
  },
  // Embed
  EMBED: {
    openai: "text-embedding-3-small",
  },
} as const;

// ── API ───────────────────────────────────────────────────────────────────────
export const API_VERSION = "v1" as const;
export const API_BASE = `/api/${API_VERSION}`;

// Rate limits (requests per window)
export const RATE_LIMITS = {
  DEFAULT: { requests: 60, windowMs: 60_000 },        // 60/min
  AI_GENERATE: { requests: 10, windowMs: 60_000 },    // 10/min
  DEPLOY: { requests: 5, windowMs: 60_000 },          // 5/min
  AUTH: { requests: 20, windowMs: 60_000 },           // 20/min
} as const;

// ── Deployment ────────────────────────────────────────────────────────────────
export const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const SLUG_REGEX = /^[a-z0-9-]+$/;
export const MAX_SUBDOMAIN_LENGTH = 63;

// Reserved slugs — users cannot pick these
export const RESERVED_SLUGS = [
  "www", "app", "api", "admin", "dashboard", "billing", "docs",
  "status", "mail", "smtp", "ftp", "cdn", "assets", "static",
  "oneatlas", "support", "help", "blog", "dev", "staging",
] as const;

// ── Pagination ────────────────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ── File sizes ────────────────────────────────────────────────────────────────
export const MAX_UPLOAD_SIZE_MB = 10;
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

// ── Cache TTLs (seconds) ──────────────────────────────────────────────────────
export const CACHE_TTL = {
  SHORT: 60,          // 1 min
  MEDIUM: 300,        // 5 min
  LONG: 3_600,        // 1 hr
  DAY: 86_400,        // 24 hr
} as const;

// ── HTTP Status Codes ─────────────────────────────────────────────────────────
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;
