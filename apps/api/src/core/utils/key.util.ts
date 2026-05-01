import path from "path";
import fs from "fs";

export function resolveRsaKey(
  value: string | undefined,
  b64Value: string | undefined,
  keyType: string,
): string {
  // Priority 1: Base64 encoded (production/Docker)
  if (b64Value) {
    const decoded = Buffer.from(b64Value, "base64").toString("utf8");
    if (!decoded.includes("-----BEGIN")) {
      throw new Error(`[RSA] ${keyType} key from base64 appears invalid`);
    }
    return decoded;
  }

  if (!value) {
    throw new Error(
      `[RSA] ${keyType} key not configured. Set ${keyType.toUpperCase()}_KEY or ${keyType.toUpperCase()}_KEY_B64`,
    );
  }

  // Priority 2: File path (local dev)
  if (
    value.endsWith(".pem") ||
    value.startsWith("./") ||
    value.startsWith("/")
  ) {
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved)) {
      throw new Error(`[RSA] ${keyType} key file not found: ${resolved}`);
    }
    const content = fs.readFileSync(resolved, "utf8");
    if (!content.includes("-----BEGIN")) {
      throw new Error(`[RSA] ${keyType} key file appears invalid: ${resolved}`);
    }
    return content;
  }

  // Priority 3: Raw PEM in env var (handle escaped newlines)
  const key = value.replace(/\\n/g, "\n");
  if (!key.includes("-----BEGIN")) {
    throw new Error(
      `[RSA] ${keyType} key env var appears invalid — expected PEM format`,
    );
  }
  return key;
}
