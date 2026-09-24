import crypto from "crypto";

// Encrypts a rotated session's successor refresh token so the rotation grace
// window can hand the SAME successor to a concurrent refresh (audit H10)
// without storing a live token in plain text. AES-256-GCM; the key is derived
// from SERVER_HMAC_PEPPER (env only, never in the database), so a database
// dump alone doesn't yield a token. Format: base64url(iv).base64url(tag).base64url(ciphertext)

const INFO = "vhyxvoid/refresh-successor/v1";

function key(): Buffer {
  const pepper = process.env.SERVER_HMAC_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error("SERVER_HMAC_PEPPER must be set (>= 32 chars) to rotate refresh tokens");
  }
  return Buffer.from(crypto.hkdfSync("sha256", pepper, Buffer.alloc(0), INFO, 32));
}

export const RefreshSuccessorCipher = {
  encrypt(rawToken: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
    const ct = Buffer.concat([cipher.update(rawToken, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
  },

  /** The raw token, or null if the value is malformed or was not made with this key. */
  decrypt(value: string): string | null {
    try {
      const [iv, tag, ct] = value.split(".").map((p) => Buffer.from(p, "base64url"));
      const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  },
};
