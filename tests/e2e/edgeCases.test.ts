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
