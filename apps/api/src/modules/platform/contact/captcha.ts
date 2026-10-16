// Cloudflare Turnstile check for the website's contact form.
//
// On when TURNSTILE_SECRET_KEY is set (the website shows the widget when the
// public setting support.captchaSiteKey is set: set both). The token the
// widget gives the browser is checked with Cloudflare once; a missing,
// expired, reused or failed token is refused. If Cloudflare can't be reached
// the message is refused too (fail closed) and the visitor is asked to try
// again, rather than letting spam through while the check is down.
//
// Cloudflare's test keys: secret 1x0000000000000000000000000000000AA always
// passes, 2x0000000000000000000000000000000AA always fails.

export type CaptchaResult = { ok: true; skipped?: boolean } | { ok: false; reason: "missing" | "failed" | "unavailable"; codes?: string[] };

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function captchaEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyCaptcha(token: string | undefined, remoteIp: string | undefined): Promise<CaptchaResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: "missing" };
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set("remoteip", remoteIp);
  try {
    const res = await fetch(process.env.TURNSTILE_VERIFY_URL || VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const body = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return body.success ? { ok: true } : { ok: false, reason: "failed", codes: body["error-codes"] ?? [] };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
