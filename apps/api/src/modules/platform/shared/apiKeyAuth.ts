// The platform API with API keys (internal-tools/shared/api-platform-plan.md, phase 7).
//
// Dashboard routes take the user's JWT. Those that declare
// `config: { apiKeyScope: "<scope>" }` also take an API key:
//
//   Authorization: Bearer <keyId>.<secret>
//
// The secret is checked like the hub checks agents (HMAC with the server
// pepper against the stored hash, the previous secret during a rotation's
// grace window), then: the key is active and not expired, its account can be
// used, it has the route's scope (or "*"), and the route's :accountId is the
// key's account. The request then acts as the member who created the key, so
// role checks (owners/admins) still apply; a key whose creator left the
// workspace stops working.
import crypto from "node:crypto";

import type { FastifyRequest } from "fastify";

import { ForbiddenError, UnauthorizedError } from "@/core/errors/error.format";
import { isConnectableAccountStatus } from "@vhyxvoid/shared";

/** Routes that any valid key may call (whoami). */
export const ANY_SCOPE = "any";

export const API_KEY_TOKEN_RE = /^(vhyxvoid_(?:dev|live)_[0-9a-f]{16,64})\.([0-9a-f]{64})$/;

export type ApiKeyPrincipal = { keyId: string; accountId: string; scopes: string[] };

type KeyRow = {
  id: string;
  keyId: string;
  accountId: string;
  createdById: string;
  secretHash: string;
  previousSecretHash: string | null;
  rotationGraceEndsAt: Date | null;
  status: string;
  expiresAt: Date | null;
  scopes: Array<{ scope: string }>;
  lastUsedAt: Date | null;
  account: { status: string } | null;
  createdBy: { email: string } | null;
};

const equalHex = (a: string, b: string) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/**
 * Verifies "keyId.secret" for a route needing `scope` on `accountId`.
 * Throws 401 for a bad key, 403 for a good key that may not do this.
 */
export async function verifyApiKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  pepper: string,
  token: string,
  scope: string,
  accountId: string | undefined,
  now = Date.now(),
): Promise<{ userId: string; email: string; key: ApiKeyPrincipal }> {
  const m = API_KEY_TOKEN_RE.exec(token);
  if (!m) throw new UnauthorizedError("Malformed API key: use <keyId>.<secret>");
  const [, keyId, secret] = m;
  const row = (await prisma.apiKey.findUnique({
    where: { keyId },
    select: { id: true, keyId: true, accountId: true, createdById: true, secretHash: true, previousSecretHash: true, rotationGraceEndsAt: true, status: true, expiresAt: true, scopes: { select: { scope: true } }, lastUsedAt: true, account: { select: { status: true } }, createdBy: { select: { email: true } } },
  })) as KeyRow | null;
  const hash = crypto.createHmac("sha256", pepper).update(secret).digest("hex");
  const graceOk = !!row?.previousSecretHash && !!row.rotationGraceEndsAt && row.rotationGraceEndsAt.getTime() > now;
  if (!row || !(equalHex(hash, row.secretHash) || (graceOk && equalHex(hash, row.previousSecretHash!)))) throw new UnauthorizedError("Invalid API key");
  if (row.status !== "ACTIVE") throw new UnauthorizedError("This API key has been revoked");
  if (row.expiresAt && row.expiresAt.getTime() < now) throw new UnauthorizedError("This API key has expired");
  if (!row.account || !isConnectableAccountStatus(row.account.status)) throw new ForbiddenError("This workspace is not active");
  const scopes = row.scopes.map((s) => s.scope);
  if (scope !== ANY_SCOPE && !scopes.includes("*") && !scopes.includes(scope)) throw new ForbiddenError(`This API key lacks the scope ${scope}`);
  if (accountId && accountId !== row.accountId) throw new ForbiddenError("This API key belongs to another workspace");
  // Last use, at most once a minute per key.
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > 60_000) void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } }).catch(() => undefined);
  return { userId: row.createdById, email: row.createdBy?.email ?? "", key: { keyId: row.keyId, accountId: row.accountId, scopes } };
}

/** The scope a route accepts API keys with, or undefined (dashboard sign-in only). */
export function routeApiKeyScope(request: FastifyRequest): string | undefined {
  const config = (request.routeOptions?.config ?? {}) as { apiKeyScope?: string };
  return config.apiKeyScope;
}

export function routeAccountId(request: FastifyRequest): string | undefined {
  const p = request.params as Record<string, string> | undefined;
  return p?.accountId;
}

// ── Per-key rate limit ────────────────────────────────────────────────────────
//
// Each verified key may make `platformApiRequestsPerMinute` (plan limit)
// requests per clock minute. Counted only after the secret checks out, so
// nobody can use up another key's allowance by sending its key ID with a
// wrong secret (per-IP limits cover guessing). One Redis INCR per request
// (shared across API instances), an in-process counter if Redis fails; the
// plan's limit is cached per workspace for a minute.

export type RateDecision = { ok: boolean; limit: number | null; remaining: number | null; resetSeconds: number };

type CounterRedis = { incr(key: string): Promise<number>; expire(key: string, seconds: number): Promise<unknown> };

export function createKeyRateLimiter(deps: { redis?: CounterRedis | null; limitFor: (accountId: string) => Promise<number>; log?: (err: unknown) => void; cacheMs?: number }) {
  const limits = new Map<string, { value: number; until: number }>();
  const local = new Map<string, { minute: number; n: number }>();

  async function limitOf(accountId: string, now: number): Promise<number> {
    const hit = limits.get(accountId);
    if (hit && hit.until > now) return hit.value;
    const value = await deps.limitFor(accountId);
    limits.set(accountId, { value, until: now + (deps.cacheMs ?? 60_000) });
    return value;
  }

  async function count(keyId: string, minute: number): Promise<number> {
    if (deps.redis) {
      try {
        const k = `papi:rl:${keyId}:${minute}`;
        const n = await deps.redis.incr(k);
        if (n === 1) await deps.redis.expire(k, 120);
        return n;
      } catch (err) {
        deps.log?.(err);
      }
    }
    const cur = local.get(keyId);
    if (!cur || cur.minute !== minute) {
      local.set(keyId, { minute, n: 1 });
      if (local.size > 10_000) for (const [k, v] of local) if (v.minute < minute) local.delete(k);
      return 1;
    }
    return ++cur.n;
  }

  return {
    async take(keyId: string, accountId: string, now = Date.now()): Promise<RateDecision> {
      const minute = Math.floor(now / 60_000);
      const resetSeconds = Math.max(1, Math.ceil(((minute + 1) * 60_000 - now) / 1000));
      const limit = await limitOf(accountId, now);
      if (!Number.isFinite(limit)) return { ok: true, limit: null, remaining: null, resetSeconds };
      const max = Math.max(0, Math.floor(limit));
      if (max === 0) return { ok: false, limit: 0, remaining: 0, resetSeconds };
      const n = await count(keyId, minute);
      return { ok: n <= max, limit: max, remaining: Math.max(0, max - n), resetSeconds };
    },
  };
}
