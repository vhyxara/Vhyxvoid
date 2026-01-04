// packages/sdk/src/sign.ts
import crypto from "crypto";

export function buildSignature({
  method,
  path,
  body,
  requestId,
  ts,
  secret,
}: {
  method: string;
  path: string;
  body?: string | null;
  requestId: string;
  ts: number;
  secret: string;
}) {
  const bodyStr = body
    ? typeof body === "string"
      ? body
      : JSON.stringify(body)
    : "";

  const bodyHash = bodyStr
    ? crypto.createHash("sha256").update(bodyStr).digest("hex")
    : "";
  const canonical = `${method.toUpperCase()}|${path}|${bodyHash}|${requestId}|${ts}`;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(canonical)
    .digest("hex");
  return { sig, ts, canonical };
}
