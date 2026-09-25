// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/utils/internalAuth.ts
// Pure, testable shared-secret check for hub-internal HTTP endpoints.
// Written for /internal/proxy (context.md risk #7; decision.md, 2026-09-12,
// "internal/proxy authentication"), which was removed 2026-09-25 as
// unreachable; kept for the planned admin-v2 /internal/stats (H4).
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
