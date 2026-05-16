// =============================================================================
// apps/api/src/lib/secrets.ts
//
// Row 18 — Security: Secrets Management
//
// AES-256-GCM encryption for sensitive values stored in the database.
// Used for:
//   - ProjectEnvVar.value  (user-defined env vars, e.g. STRIPE_SECRET_KEY)
//   - Integration.accessToken / refreshToken
//
// Key derivation:
//   APP_SECRET (env) → HKDF-SHA256 → 256-bit AES key
//   A unique 12-byte IV is generated per encryption and stored alongside
//   the ciphertext (format: base64(iv + authTag + ciphertext)).
//
// The APP_SECRET must be at least 32 chars. Rotate it by re-encrypting
//  all secrets (provide a migration script — not in scope for Row 18).
// =============================================================================

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IV — recommended for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

// ── Key derivation ────────────────────────────────────────────────────────────

let _cryptoKey: CryptoKey | null = null;

async function getDerivedKey(): Promise<CryptoKey> {
  if (_cryptoKey) return _cryptoKey;

  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "APP_SECRET must be set and at least 32 characters. Generate one with: openssl rand -base64 32"
    );
  }

  const encoder = new TextEncoder();

  // Import raw secret as HKDF key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"]
  );

  // Derive AES-GCM key via HKDF-SHA256
  _cryptoKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("oneatlas-secrets-v1"),
      info: encoder.encode("env-var-encryption"),
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );

  return _cryptoKey;
}

// ── Encrypt ───────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string: iv(12b) + authTag(16b) + ciphertext
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getDerivedKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: AUTH_TAG_LENGTH * 8 },
    key,
    encoder.encode(plaintext)
  );

  // Concatenate iv + ciphertext+tag
  const result = new Uint8Array(IV_LENGTH + ciphertextWithTag.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertextWithTag), IV_LENGTH);

  return Buffer.from(result).toString("base64");
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

/**
 * Decrypt a base64-encoded string produced by encrypt().
 */
export async function decrypt(encoded: string): Promise<string> {
  const key = await getDerivedKey();
  const data = Buffer.from(encoded, "base64");

  const iv = data.subarray(0, IV_LENGTH);
  const ciphertextWithTag = data.subarray(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, tagLength: AUTH_TAG_LENGTH * 8 },
    key,
    ciphertextWithTag
  );

  return new TextDecoder().decode(plaintext);
}

// ── Helpers for ProjectEnvVar ─────────────────────────────────────────────────

/**
 * Encrypt an env var value before writing to DB.
 * Non-secret vars are still encrypted — the isSecret flag controls UI display.
 */
export async function encryptEnvValue(value: string): Promise<string> {
  return encrypt(value);
}

/**
 * Decrypt an env var value after reading from DB.
 */
export async function decryptEnvValue(encoded: string): Promise<string> {
  return decrypt(encoded);
}

/**
 * Decrypt a map of { key → encryptedValue } → { key → plaintext }
 * Used when injecting env vars into a generated worker.
 */
export async function decryptEnvMap(
  vars: { key: string; value: string }[]
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    vars.map(async ({ key, value }) => [key, await decryptEnvValue(value)])
  );
  return Object.fromEntries(entries);
}
