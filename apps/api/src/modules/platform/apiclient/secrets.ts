// Environment secret values at rest: AES-256-GCM, key derived from
// SERVER_HMAC_PEPPER (env only), like RefreshSuccessorCipher. A database dump
// alone doesn't reveal them, and the API never returns them: the dashboard
// shows "set" and sends `keep: true` to leave a value as it is.
import crypto from "crypto";

const INFO = "vhyxvoid/api-client-secret/v1";
const PREFIX = "enc:v1:";

function key(): Buffer {
  const pepper = process.env.SERVER_HMAC_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error("SERVER_HMAC_PEPPER must be set (>= 32 chars) to store environment secrets");
  return Buffer.from(crypto.hkdfSync("sha256", pepper, Buffer.alloc(0), INFO, 32));
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

/** The value, or "" when it can't be read (made with another key). Plain values pass through. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    const [iv, tag, ct] = stored.slice(PREFIX.length).split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
