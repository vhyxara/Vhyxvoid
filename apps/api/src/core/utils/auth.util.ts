// The user refresh-token cookie. (The old signature middleware, token helpers
// and @fastify/jwt glue that lived here were dead code: audit L4/L5.)
import { FastifyReply, FastifyRequest } from "fastify";
import { REFRESH_COOKIE_NAME, TTL } from "@/core/constant/ttl.constant";

/**
 * Name and path of a refresh-token cookie. In production it carries the
 * `__Host-` prefix, which needs Secure, Path=/ and no Domain: tunnels and
 * mock APIs serve customers' pages on subdomains of the same site, and from
 * there a plain cookie can be planted with `Domain=<site>` ("cookie
 * tossing"), logging a signed-out visitor into the planter's session.
 * Browsers refuse a `__Host-` cookie that has a Domain or comes from another
 * host. Without HTTPS (local development) the prefix can't be set, so the
 * plain name and the narrow path are used.
 */
export function refreshCookieSpec(base: string, devPath: string): { name: string; path: string; secure: boolean } {
  return process.env.NODE_ENV === "production" ? { name: `__Host-${base}`, path: "/", secure: true } : { name: base, path: devPath, secure: false };
}
const userCookie = () => refreshCookieSpec(REFRESH_COOKIE_NAME, "/api/v1/auth");

export function setRefreshCookie(reply: FastifyReply, token: string) {
  const c = userCookie();
  reply.setCookie(c.name, token, {
    httpOnly: true, // JS cannot read this — XSS-proof
    secure: c.secure, // HTTPS only in prod
    sameSite: "strict", // CSRF protection
    path: c.path, // dev: auth endpoints only; prod: "/" (required by __Host-)
    maxAge: TTL.REFRESH_TOKEN_MS / 1000, // seconds
  });
}

export function clearRefreshCookie(reply: FastifyReply) {
  const c = userCookie();
  reply.clearCookie(c.name, { path: c.path, secure: c.secure });
}

export function getRefreshCookie(request: FastifyRequest): string | undefined {
  return request.cookies[userCookie().name];
}
