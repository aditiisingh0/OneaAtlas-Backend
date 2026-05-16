// =============================================================================
// apps/api/src/lib/sanitize.ts
//
// Row 18 — Security: Input Sanitization
//
// Utilities called by route handlers (and optionally middleware) to:
//   1. sanitizeString()    — strip HTML/script tags from user text
//   2. sanitizeObject()    — recursively sanitize all string fields in a JSON obj
//   3. assertSafeContentType() — reject non-JSON content types
//   4. assertPayloadSize() — reject oversized request bodies
//
// We intentionally avoid a heavy DOM parser (no jsdom in Edge/serverless).
// The regex approach below is sufficient for stripping injected tags from
// text that will be stored in Postgres or rendered in generated UIs.
// Full HTML sanitization (allowlisting tags) is out of scope here —
// generated app output is rendered in an isolated iframe/worker context.
// =============================================================================

import { ValidationError } from "@oneatlas/shared";

// ── String sanitization ───────────────────────────────────────────────────────

// Patterns to strip
const SCRIPT_TAG_RE = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const ON_ATTR_RE = /\s*on\w+\s*=\s*["'][^"']*["']/gi; // onclick="..." etc.
const HTML_TAG_RE = /<[^>]+>/g;
const NULL_BYTE_RE = /\x00/g;

/**
 * Strip dangerous HTML from a string.
 * Does NOT entity-encode — the output is still human-readable text.
 */
export function sanitizeString(input: string): string {
  return input
    .replace(NULL_BYTE_RE, "")     // null bytes
    .replace(SCRIPT_TAG_RE, "")    // <script>...</script>
    .replace(ON_ATTR_RE, "")       // onclick="..." onerror="..." etc.
    .replace(HTML_TAG_RE, "")      // all remaining tags
    .trim();
}

/**
 * Recursively sanitize all string values in a plain object.
 * Arrays of strings are also sanitized.
 * Non-string primitives are passed through unchanged.
 */
export function sanitizeObject<T>(input: T): T {
  if (typeof input === "string") {
    return sanitizeString(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map(sanitizeObject) as unknown as T;
  }

  if (input !== null && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      result[key] = sanitizeObject(value);
    }
    return result as T;
  }

  return input;
}

// ── Content-type guard ────────────────────────────────────────────────────────

/**
 * Throw ValidationError if the request Content-Type is not application/json.
 * Call at the top of any POST/PATCH/PUT handler that expects JSON.
 */
export function assertJsonContentType(contentType: string | null): void {
  if (!contentType?.includes("application/json")) {
    throw new ValidationError(
      "Content-Type must be application/json",
      { received: contentType }
    );
  }
}

// ── Payload size guard ────────────────────────────────────────────────────────

const DEFAULT_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Throw ValidationError if Content-Length exceeds maxBytes.
 * Note: Content-Length can be spoofed — this is a first-pass guard.
 * The actual body is bounded by Next.js's built-in body size limit.
 */
export function assertPayloadSize(
  contentLength: string | null,
  maxBytes = DEFAULT_MAX_BYTES
): void {
  if (contentLength === null) return; // chunked encoding — skip

  const bytes = parseInt(contentLength, 10);
  if (!isNaN(bytes) && bytes > maxBytes) {
    throw new ValidationError(
      `Payload too large. Maximum size is ${maxBytes / 1024}KB`,
      { received: bytes, limit: maxBytes }
    );
  }
}

// ── SQL injection hints (defense-in-depth) ────────────────────────────────────

// Prisma uses parameterised queries, so SQL injection is already blocked.
// This is a belt-and-suspenders check for raw query fragments if any ever
// get added to the codebase.
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC)\b)/i,
  /('|--|;|\/\*|\*\/)/,
];

export function containsSqlInjection(input: string): boolean {
  return SQL_INJECTION_PATTERNS.some((re) => re.test(input));
}

/**
 * Throw if a string that will be used in a raw query contains SQL injection.
 * (Not needed for Prisma ORM calls, only for prisma.$queryRaw usage.)
 */
export function assertNoSqlInjection(input: string, field = "input"): void {
  if (containsSqlInjection(input)) {
    throw new ValidationError(`${field} contains disallowed characters`);
  }
}
