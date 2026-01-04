// apps/hub/src/auth.ts
import crypto from "crypto";
import { getFrontendSecret } from "./store";

/**
 * signaturePayload:
 * { method, path, bodyBase64, requestId, ts, signature, frontendKey }
 *
 * Returns true if valid.
 */

export function verifySignature(payload: {
  method: string;
  path: string;
  bodyBase64?: string | null;
  requestId: string;
  ts: number;
  signature: string;
  frontendKey: string;
}) {
  const { method, path, bodyBase64, requestId, ts, signature, frontendKey } =
    payload;
  const secret = getFrontendSecret(frontendKey);
  if (!secret) return false;

  // reconstruct canonical string
  const body = bodyBase64 ? Buffer.from(bodyBase64, "base64").toString() : "";
  const bodyHash = body
    ? crypto.createHash("sha256").update(body).digest("hex")
    : "";
  const canonical = `${method.toUpperCase()}|${path}|${bodyHash}|${requestId}|${ts}`;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(canonical)
    .digest("hex");

  // timing safe compare
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) return false;
    if (!crypto.timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }

  const signatureMatch = crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );

  // time window (ms)
  const now = Date.now();
  const delta = Math.abs(now - ts);
  const MAX_WINDOW = Number(process.env.SIGNATURE_TIME_WINDOW_MS || 60_000);
  if (delta > MAX_WINDOW) return false;

  return signatureMatch;
}
