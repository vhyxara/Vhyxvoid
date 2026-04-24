// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/canonical.ts
// Canonical string builder — identical in Hub (verify) and SDK (sign).
// Query string is included to prevent query-parameter injection attacks.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";

export interface CanonicalParams {
  method: string;
  path: string;
  query: string;
  body: string; // raw body string, or empty string
  requestId: string;
  ts: number; // unix milliseconds
}

/**
 * Build the canonical string that both sides sign/verify.
 * Format: METHOD|PATH|QUERY|BODY_SHA256|REQUEST_ID|TIMESTAMP_MS
 *
 * All fields are always present (empty string if absent).
 * Order is fixed — SDK and Hub must agree exactly.
 */
export function buildCanonical(params: CanonicalParams): string {
  const bodyHash = params.body
    ? crypto.createHash("sha256").update(params.body, "utf8").digest("hex")
    : "";

  return [
    params.method.toUpperCase(),
    params.path,
    params.query,
    bodyHash,
    params.requestId,
    params.ts.toString(),
  ].join("|");
}

/**
 * Sign a canonical string with HMAC-SHA256.
 * secretHash = HMAC-SHA256(rawSecret, SERVER_HMAC_PEPPER) — stored in DB.
 * Agent signs using the same secretHash.
 */
export function signCanonical(canonical: string, secretHash: string): string {
  return crypto
    .createHmac("sha256", secretHash)
    .update(canonical)
    .digest("hex");
}

/**
 * Timing-safe HMAC verification.
 * Returns false if lengths differ (prevents length-extension attacks).
 */
export function verifyCanonical(
  canonical: string,
  signature: string,
  secretHash: string,
): boolean {
  try {
    const expected = signCanonical(canonical, secretHash);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
