// =============================================================================
// packages/shared/src/utils.ts
// Pure utility functions — no external dependencies.
// =============================================================================

import { RESERVED_SLUGS, SLUG_REGEX, SUBDOMAIN_REGEX } from "./constants";

// ── String utilities ──────────────────────────────────────────────────────────

/**
 * Convert any string to a URL-safe slug.
 * "My CRM App" → "my-crm-app"
 */
export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 63);
}

/**
 * Check if a slug is valid and not reserved.
 */
export function isValidSlug(slug: string): boolean {
  if (!SLUG_REGEX.test(slug)) return false;
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return false;
  return slug.length >= 2 && slug.length <= 63;
}

/**
 * Check if a subdomain is valid.
 */
export function isValidSubdomain(subdomain: string): boolean {
  return SUBDOMAIN_REGEX.test(subdomain) && subdomain.length <= 63;
}

/**
 * Build the full app URL for a deployed project.
 * "crm-acme" → "https://crm-acme.oneatlas.app"
 */
export function buildAppUrl(subdomain: string, domain = "oneatlas.app"): string {
  return `https://${subdomain}.${domain}`;
}

/**
 * Truncate a string to maxLength with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Capitalize first letter only.
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Object utilities ──────────────────────────────────────────────────────────

/**
 * Remove undefined/null keys from an object (useful for Prisma updates).
 */
export function stripNullish<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v != null)
  ) as Partial<T>;
}

/**
 * Pick specific keys from an object.
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  return keys.reduce((acc, key) => {
    if (key in obj) acc[key] = obj[key];
    return acc;
  }, {} as Pick<T, K>);
}

/**
 * Omit specific keys from an object.
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const copy = { ...obj };
  keys.forEach((k) => delete copy[k]);
  return copy;
}

// ── Date utilities ────────────────────────────────────────────────────────────

/**
 * Format a date as "Jan 14, 2026".
 */
export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

/**
 * Format as "2h 34m ago" etc.
 */
export function timeAgo(date: Date | string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

// ── Async utilities ───────────────────────────────────────────────────────────

/**
 * Sleep for ms milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function up to maxAttempts times with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 300
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  throw lastError;
}

// ── Crypto utilities ──────────────────────────────────────────────────────────

/**
 * Generate a secure random token (e.g. for API keys, webhook secrets).
 * Returns a hex string of length `bytes * 2`.
 */
export function generateToken(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate an API key with a prefix. "oa_live_abc123..."
 */
export function generateApiKey(env: "live" | "test" = "live"): {
  key: string;
  prefix: string;
} {
  const token = generateToken(32);
  const key = `oa_${env}_${token}`;
  const prefix = key.slice(0, 12);
  return { key, prefix };
}

/**
 * SHA-256 hash a string (for API key storage).
 * Works in both Node.js and edge runtime.
 */
export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
