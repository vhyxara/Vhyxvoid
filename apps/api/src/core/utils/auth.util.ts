// The user refresh-token cookie. (The old signature middleware, token helpers
// and @fastify/jwt glue that lived here were dead code: audit L4/L5.)
import { FastifyReply, FastifyRequest } from "fastify";
import { REFRESH_COOKIE_NAME, TTL } from "@/core/constant/ttl.constant";

export function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true, // JS cannot read this — XSS-proof
    secure: process.env.NODE_ENV === "production", // HTTPS only in prod
    sameSite: "strict", // CSRF protection
    path: "/api/v1/auth", // Cookie only sent to auth endpoints — minimises exposure
    maxAge: TTL.REFRESH_TOKEN_MS / 1000, // seconds
  });
}

export function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE_NAME, {
    path: "/api/v1/auth",
  });
}

export function getRefreshCookie(request: FastifyRequest): string | undefined {
  return request.cookies[REFRESH_COOKIE_NAME];
}
