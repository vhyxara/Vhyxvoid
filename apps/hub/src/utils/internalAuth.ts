// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/utils/internalAuth.ts
// Pure, testable auth check for the /internal/proxy endpoint.
// See context.md risk #7 and decision.md, 2026-09-12, "internal/proxy
// authentication".
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';

/**
 * Constant-time check of a provided header value against the expected
 * internal secret. Fails closed: no configured secret → always
 * unauthorized, regardless of what the caller sends.
 */
export function isInternalRequestAuthorized(
  headerValue: string | string[] | undefined,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;

  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
