import { describe, it, expect, vi } from "vitest";
import Fastify from "../../apps/api/node_modules/fastify";
import fastifyRateLimit from "../../apps/api/node_modules/@fastify/rate-limit";
import {
  TRUST_PROXY,
  GLOBAL_RATE_LIMIT,
  AUTH_RATE_LIMITS,
} from "../../apps/api/src/core/constant/rateLimit.constant";
import { getAuditMetadata } from "../../apps/api/src/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { getClientIpAddress } from "../../apps/api/src/modules/identity/domain/services/TokenExtractor";
import { identityRoutes } from "../../apps/api/src/modules/identity/presentation/http/user/identity.routes";
import { adminRoutes } from "../../apps/api/src/modules/identity/presentation/http/admin/admin.routes";
import { registerPlugins } from "../../apps/api/src/modules/identity/presentation/plugins/register.plugin";

// Covers api/decision.md, 2026-09-24, "H1". Behind Cloudflare -> nginx ->
// api, Fastify had no trustProxy, so request.ip was nginx for everyone (one
// shared rate-limit bucket), and the audit-log IP helpers read the FIRST
// X-Forwarded-For entry, which the client controls.
//
// The simulated chain matches production: nginx's peer address is on the
// compose bridge (172.18.0.4), and nginx appends the visitor it resolved
// from CF-Connecting-IP as the LAST X-Forwarded-For entry.

const NGINX = "172.18.0.4";
const CLIENT_A = "203.0.113.7";
const CLIENT_B = "198.51.100.9";
const viaNginx = (client: string, forgedPrefix?: string) => ({
  remoteAddress: NGINX,
  headers: { "x-forwarded-for": forgedPrefix ? `${forgedPrefix}, ${client}` : client },
});

async function buildApp() {
  const app = Fastify({ trustProxy: TRUST_PROXY });
  await app.register(fastifyRateLimit, GLOBAL_RATE_LIMIT);
  app.get("/ip", async (request) => ({
    ip: request.ip,
    audit: getAuditMetadata(request, 200).ipAddress,
    token: getClientIpAddress(request),
  }));
  app.post("/login", { config: { rateLimit: AUTH_RATE_LIMITS.login } }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("client IP resolution behind Cloudflare + nginx", () => {
  it("uses the visitor nginx appended, not a forged first X-Forwarded-For entry", async () => {
    const app = await buildApp();
    const r = await app.inject({ url: "/ip", ...viaNginx(CLIENT_A, "6.6.6.6") });
    expect(r.json()).toEqual({ ip: CLIENT_A, audit: CLIENT_A, token: CLIENT_A });
  });

  it("ignores X-Forwarded-For entirely from a peer that is not a trusted proxy", async () => {
    const app = await buildApp();
    const r = await app.inject({
      url: "/ip",
      remoteAddress: "192.0.2.50", // a public address talking to the api directly
      headers: { "x-forwarded-for": "6.6.6.6" },
    });
    expect(r.json()).toEqual({ ip: "192.0.2.50", audit: "192.0.2.50", token: "192.0.2.50" });
  });
});

describe("rate-limit buckets are per client, not per nginx", () => {
  it("two clients behind the same nginx get independent login buckets", async () => {
    const app = await buildApp();
    const login = (client: string) => app.inject({ method: "POST", url: "/login", ...viaNginx(client) });

    for (let i = 0; i < AUTH_RATE_LIMITS.login.max; i++) expect((await login(CLIENT_A)).statusCode).toBe(200);
    expect((await login(CLIENT_A)).statusCode).toBe(429);
    expect((await login(CLIENT_B)).statusCode).toBe(200);
  });

  it("a forged X-Forwarded-For does not buy a fresh bucket", async () => {
    const app = await buildApp();
    for (let i = 0; i < AUTH_RATE_LIMITS.login.max; i++) {
      await app.inject({ method: "POST", url: "/login", ...viaNginx(CLIENT_A, `10.0.0.${i}`) });
    }
    const r = await app.inject({ method: "POST", url: "/login", ...viaNginx(CLIENT_A, "10.9.9.9") });
    expect(r.statusCode).toBe(429);
  });

  it("one client exhausting the global limit does not block another", async () => {
    const app = await buildApp();
    for (let i = 0; i < GLOBAL_RATE_LIMIT.max; i++) await app.inject({ url: "/ip", ...viaNginx(CLIENT_A) });
    expect((await app.inject({ url: "/ip", ...viaNginx(CLIENT_A) })).statusCode).toBe(429);
    expect((await app.inject({ url: "/ip", ...viaNginx(CLIENT_B) })).statusCode).toBe(200);
  });
});

describe("the real api wiring", () => {
  function captureRoutes() {
    const opts = new Map<string, any>();
    const capture = (method: string) => (path: string, o: any, h?: any) => {
      opts.set(`${method} ${path}`, h ? o : {});
    };
    const fake: any = new Proxy(
      { get: capture("GET"), post: capture("POST"), put: capture("PUT"), patch: capture("PATCH"), delete: capture("DELETE") },
      { get: (t, k) => (k in t ? (t as any)[k] : vi.fn()) },
    );
    return { fake, opts };
  }

  it("the four auth routes and admin login carry their tighter per-route limits", async () => {
    const { fake, opts } = captureRoutes();
    await identityRoutes(fake);
    await adminRoutes(fake);

    expect(opts.get("POST /login")?.config?.rateLimit).toEqual(AUTH_RATE_LIMITS.login);
    expect(opts.get("POST /register")?.config?.rateLimit).toEqual(AUTH_RATE_LIMITS.register);
    expect(opts.get("POST /forgot-password")?.config?.rateLimit).toEqual(AUTH_RATE_LIMITS.forgotPassword);
    expect(opts.get("POST /resend-verification")?.config?.rateLimit).toEqual(AUTH_RATE_LIMITS.resendVerification);
    expect(opts.get("POST /auth/login")?.config?.rateLimit).toEqual(AUTH_RATE_LIMITS.adminLogin);
  });

  it("registers the rate limiter before any other plugin, so no route escapes it", async () => {
    const registered: unknown[] = [];
    const fake: any = new Proxy(
      { register: vi.fn(async (plugin: unknown) => void registered.push(plugin)) },
      { get: (t, k) => (k in t ? (t as any)[k] : vi.fn()) },
    );

    await registerPlugins(fake).catch(() => {}); // later plugins may need a real server; only order matters

    expect(registered[0]).toBe(fastifyRateLimit);
    expect(fake.register.mock.calls[0][1]).toEqual(GLOBAL_RATE_LIMIT);
  });
});
