// apps/hub/src/store.ts
/**
 * Minimal key store for MVP.
 * Set env FRONTEND_KEYS like: "front-demo:secret123,front-other:sekrit"
 */

type FrontKey = { key: string; secret: string };

const FRONTEND_KEYS: Map<string, string> = new Map();

export function initKeyStoreFromEnv() {
  const v = process.env.FRONTEND_KEYS || "";
  if (!v) return;
  const pairs = v.split(",");
  for (const p of pairs) {
    const [k, s] = p.split(":");
    if (k && s) FRONTEND_KEYS.set(k.trim(), s.trim());
  }
  console.log(
    "[store] loaded frontend keys:",
    Array.from(FRONTEND_KEYS.keys())
  );
}

export function getFrontendSecret(frontendKey: string): string | null {
  return FRONTEND_KEYS.get(frontendKey) ?? null;
}

// helper to add keys programmatically (used by dashboard later)
export function addFrontendKey(key: string, secret: string) {
  FRONTEND_KEYS.set(key, secret);
  return true;
}
