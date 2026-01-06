// packages/sdk/src/sign.ts
import crypto from "crypto";

export function buildSignature({
  method,
  path,
  bodyBase64,
  requestId,
  ts,
  secret,
}: {
  method: string;
  path: string;
  bodyBase64?: string | null;
  requestId: string;
  ts: number;
  secret: string;
}) {
  const body = bodyBase64 ? Buffer.from(bodyBase64, "base64").toString() : "";
  const bodyHash = body
    ? crypto.createHash("sha256").update(body).digest("hex")
    : "";
  const canonical = `${method.toUpperCase()}|${path}|${bodyHash}|${requestId}|${ts}`;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(canonical)
    .digest("hex");
  return { sig };
}
