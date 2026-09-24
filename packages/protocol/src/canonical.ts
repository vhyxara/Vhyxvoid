// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/canonical.ts
// Canonical string builder — the ONE implementation both the SDK (sign) and
// packages/shared's ValidateApiKeyUseCase (verify) use. The verifier used to
// keep its own copy with the query hard-coded to "", so the query was never
// actually signed (audit H8).
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

/** Leading tag of the canonical string; bump whenever the format changes. */
export const CANONICAL_VERSION = "vv2";

/**
 * Build the canonical string that both sides sign/verify.
 * Format: vv2|<len>:METHOD|<len>:PATH|<len>:QUERY|<len>:BODY_SHA256|<len>:REQUEST_ID|<len>:TIMESTAMP_MS
 * where <len> is the field's UTF-8 byte length.
 *
 * Every field is length-prefixed, so a "|" inside one (a path such as
 * "/a|b", or a requestId) can't be read as a boundary: in the old plain
 * "|"-joined format, path "/x|q=1" + query "" and path "/x" + query "q=1|"
 * produced the same string. All fields are always present (empty string if
 * absent); order is fixed.
 */
export function buildCanonical(params: CanonicalParams): string {
  const bodyHash = params.body
    ? crypto.createHash("sha256").update(params.body, "utf8").digest("hex")
    : "";

  const fields = [
    params.method.toUpperCase(),
    params.path,
    params.query,
    bodyHash,
    params.requestId,
    params.ts.toString(),
  ];
  return [
    CANONICAL_VERSION,
    ...fields.map((f) => `${Buffer.byteLength(f, "utf8")}:${f}`),
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
