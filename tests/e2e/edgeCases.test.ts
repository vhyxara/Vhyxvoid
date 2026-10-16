// Regressions from the 2026-10-08 edge-case sweep of every API route
// (malformed params, bodies and queries as owner, API key, admin, anonymous):
//   1. a text/plain POST to the Stripe webhook ended the API process;
//   2. NUL characters / unpaired surrogates reached Postgres (500s);
//   3. negative or fractional audit-log paging reached Prisma (500);
//   4. the API key use cases were scoped to their own plugin, so the usage
//      endpoint outside it always answered 500.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { rejectUnsafeText, unsafeTextAt } from "../../apps/api/src/core/middleware/unsafe-text.middleware";
import { auditLogsQuerySchema } from "../../apps/api/src/modules/identity/application/dto/admin.dto";
import { stripeWebhookRoutes } from "../../apps/api/src/modules/billing/presentation/http/webhook.routes";
import { ApiKeyPlugins } from "../../apps/api/src/modules/key-management/presentation/plugins/usecases/api-plugins";

const req = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const Fastify = req("fastify");
const rawBody = req("fastify-raw-body");

describe("unsafe text is a 400, not a database error", () => {
  it("finds NUL and unpaired surrogates anywhere, keys included; leaves real text alone", () => {
    expect(unsafeTextAt({ a: "ok", b: ["x", { c: "emoji 😀 and accents é" }] }, "body")).toBeNull();
    expect(unsafeTextAt({ a: "x\u0000y" }, "body")).toBe("body.a");
    expect(unsafeTextAt({ list: [{ name: "fine" }, { name: "\ud800" }] }, "body")).toBe("body.list.1.name");
    expect(unsafeTextAt({ tail: "a\udc00" }, "body")).toBe("body.tail");
    expect(unsafeTextAt({ "\u0000": 1 }, "body")).toBe("body (a key)");
    expect(unsafeTextAt("\u0000", "params")).toBe("params");
    expect(unsafeTextAt(Buffer.from([0, 1, 2]), "body")).toBeNull(); // raw bodies are not text
    // Deep nesting is walked without recursion.
    let deep: unknown = "\u0000";
    for (let i = 0; i < 20_000; i++) deep = [deep];
    expect(unsafeTextAt(deep, "body")).toMatch(/^body(\.0)+$/);
  });

  it("the hook answers 400 for params, query and body", async () => {
    const f = Fastify();
    f.setErrorHandler((err: any, _r: any, reply: any) => reply.code(err.statusCode ?? 500).send({ message: err.message }));
    f.addHook("preValidation", rejectUnsafeText);
    f.post("/x/:id", async () => ({ ok: true }));
    await f.ready();
    const r1 = await f.inject({ method: "POST", url: "/x/%00", payload: {} });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().message).toMatch(/params\.id/);
    expect((await f.inject({ method: "POST", url: "/x/1?q=%00", payload: {} })).statusCode).toBe(400);
    expect((await f.inject({ method: "POST", url: "/x/1", headers: { "content-type": "application/json" }, payload: '{"name":"a\\u0000"}' })).statusCode).toBe(400);
    expect((await f.inject({ method: "POST", url: "/x/1", payload: { name: "Grüße 😀" } })).statusCode).toBe(200);
    await f.close();
  });
});

describe("the Stripe webhook takes JSON only", () => {
  it("refuses other content types before reading the body, and needs a signature", async () => {
    const f = Fastify();
    f.setErrorHandler((err: any, _r: any, reply: any) => reply.code(err.statusCode ?? 500).send({ message: err.message }));
    await f.register(rawBody, { field: "rawBody", global: false, encoding: false, runFirst: true });
    let seen: Buffer | null = null;
    f.decorate("handleStripeWebhookUseCase", { execute: async (payload: Buffer) => ((seen = payload), { received: true }) });
    await f.register(stripeWebhookRoutes);
    await f.ready();
    const post = (type: string | null, payload: string, signature = "t=1,v1=x") =>
      f.inject({ method: "POST", url: "/api/v1/billing/webhooks/stripe", headers: { ...(type ? { "content-type": type } : {}), ...(signature ? { "stripe-signature": signature } : {}) }, payload });
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "application/octet-stream", null]) expect((await post(type, "hello")).statusCode).toBe(415);
    expect((await post("application/json", "{}", "")).statusCode).toBe(400);
    const ok = await post("application/json; charset=utf-8", '{"id":"evt_1"}');
    expect(ok.statusCode).toBe(200);
    expect(Buffer.isBuffer(seen) && seen!.toString()).toBe('{"id":"evt_1"}'); // the raw bytes reach the signature check
    await f.close();
  });
});

describe("paging and plugin scope", () => {
  it("audit-log paging rejects negative, fractional and huge values", () => {
    expect(auditLogsQuerySchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
    for (const q of [{ limit: "-5" }, { limit: "0" }, { limit: "1.5" }, { limit: "1e309" }, { offset: "-1" }, { offset: "2.5" }, { offset: "99999999" }]) expect(auditLogsQuerySchema.safeParse(q).success).toBe(false);
  });

  it("the API key use cases are decorated outside their own plugin (fastify-plugin)", () => {
    expect((ApiKeyPlugins as unknown as Record<symbol, unknown>)[Symbol.for("skip-override")]).toBe(true);
  });
});

// 2026-10-16: URL forms that reach the platform's own network. IPv4-compatible,
// IPv4-translated, 6to4 and Teredo IPv6 literals passed the address check, and
// a trailing dot ("localhost.") passed the name check (the connect-time lookup
// still refused those names; the message was the confusing one).
describe("private targets for the API client, monitors and alert webhooks", () => {
  it("are refused in every spelling", async () => {
    const { isPrivateHost, validateWebhookUrl } = await import("../../apps/api/src/modules/platform/alerts/webhook");
    const { targetProblem } = await import("../../apps/api/src/modules/platform/apiclient/runner");
    const saved = { a: process.env.API_CLIENT_ALLOW_PRIVATE, b: process.env.ALERT_WEBHOOK_ALLOW_PRIVATE };
    delete process.env.API_CLIENT_ALLOW_PRIVATE;
    delete process.env.ALERT_WEBHOOK_ALLOW_PRIVATE;
    try {
      const refused = ["http://127.0.0.1/", "http://2130706433/", "http://0x7f000001/", "http://127.1/", "http://0/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::127.0.0.1]/", "http://[::ffff:0:7f00:1]/", "http://[2002:7f00:1::]/", "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/", "http://[64:ff9b::a9fe:a9fe]/", "http://169.254.169.254/", "http://[fd00::1]/", "http://[fe80::1]/", "http://localhost./", "http://LOCALHOST/", "http://foo.localhost/", "http://metadata.google.internal./", "http://router.home.arpa/", "http://printer.local/"];
      for (const s of refused) {
        expect(isPrivateHost(new URL(s).hostname), s).toBe(true);
        expect(targetProblem(new URL(s)), s).toBeTruthy();
        expect(validateWebhookUrl(s), s).toBeTruthy();
      }
      for (const s of ["https://example.com/", "https://93.184.216.34/", "https://[2606:4700:4700::1111]/", "https://[2001:4860:4860::8888]/", "https://hooks.slack.com/services/x"]) {
        expect(isPrivateHost(new URL(s).hostname), s).toBe(false);
        expect(targetProblem(new URL(s)), s).toBeUndefined();
      }
    } finally {
      if (saved.a !== undefined) process.env.API_CLIENT_ALLOW_PRIVATE = saved.a;
      if (saved.b !== undefined) process.env.ALERT_WEBHOOK_ALLOW_PRIVATE = saved.b;
    }
  });
});

// 2026-10-16: tunnels and mocks serve customer pages on subdomains of the
// platform's site, so in production the refresh cookies carry the __Host-
// prefix: a cookie planted from a subdomain with Domain=<site> can't use it.
describe("refresh cookies can't be planted from a tunnel subdomain", () => {
  it("are __Host- prefixed, Secure, Path=/ and domain-less in production; plain in development", async () => {
    const { setRefreshCookie, getRefreshCookie, refreshCookieSpec } = await import("../../apps/api/src/core/utils/auth.util");
    const cookie = req("@fastify/cookie");
    const env = process.env.NODE_ENV;
    try {
      for (const mode of ["production", "development"]) {
        process.env.NODE_ENV = mode;
        const f = Fastify();
        await f.register(cookie);
        f.get("/set", async (_r: any, reply: any) => (setRefreshCookie(reply, "tok"), { ok: true }));
        f.get("/get", async (r: any) => ({ token: getRefreshCookie(r) ?? null }));
        const set = String((await f.inject({ method: "GET", url: "/set" })).headers["set-cookie"]);
        if (mode === "production") {
          expect(set).toMatch(/^__Host-refresh_token=tok;/);
          expect(set).toMatch(/Path=\//);
          expect(set).toMatch(/Secure/);
          expect(set).not.toMatch(/Domain=/i);
          expect((await f.inject({ method: "GET", url: "/get", headers: { cookie: "refresh_token=planted" } })).json().token).toBeNull();
          expect((await f.inject({ method: "GET", url: "/get", headers: { cookie: "__Host-refresh_token=tok" } })).json().token).toBe("tok");
        } else {
          expect(set).toMatch(/^refresh_token=tok;.*Path=\/api\/v1\/auth/);
        }
        await f.close();
      }
      process.env.NODE_ENV = "production";
      expect(refreshCookieSpec("vv_admin_rt", "/api/v1/admin/identity/auth")).toEqual({ name: "__Host-vv_admin_rt", path: "/", secure: true });
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});
