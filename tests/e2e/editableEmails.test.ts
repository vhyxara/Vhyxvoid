// Email wording from the admin panel: untouched emails are sent exactly as
// built; edited ones use the admin's words with {{variables}} filled in and
// HTML escaped; unknown variables and fields are refused; empty fields fall
// back to the built-in wording; reset brings the original back.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { validateSettingValue } from "../../packages/shared/src/settings";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { emailVerification, passwordResetRequest, setEmailOverrides } from "../../apps/api/src/modules/notification/infrastructure/email/templates";
import { adminEmailRoutes, setEmailsMailer } from "../../apps/api/src/modules/platform/emails/emails.routes";

const require = createRequire(import.meta.url);
const Fastify = require("../../apps/api/node_modules/fastify");

describe("editable emails", () => {
  afterAll(() => setEmailOverrides({}));

  it("are sent exactly as built until someone edits them", () => {
    setEmailOverrides({});
    const built = emailVerification({ firstName: "Ada", verifyUrl: "https://x.test/v?t=1" });
    setEmailOverrides({ passwordResetRequest: { subject: "Other email" } });
    expect(emailVerification({ firstName: "Ada", verifyUrl: "https://x.test/v?t=1" })).toEqual(built);
    // Only empty fields: still the built email.
    setEmailOverrides({ emailVerification: { subject: "  " } });
    expect(emailVerification({ firstName: "Ada", verifyUrl: "https://x.test/v?t=1" })).toEqual(built);
  });

  it("use the admin's words, with variables filled in and HTML escaped", () => {
    setEmailOverrides({ emailVerification: { subject: "Welcome, {{firstName}}!", body: "Hi **{{firstName}}**,\n\nOne click and you're in." } });
    const m = emailVerification({ firstName: "<b>Ada</b>", verifyUrl: "https://x.test/v?t=1&x=2" });
    expect(m.subject).toBe("Welcome, <b>Ada</b>!");
    expect(m.html).toContain("Hi <strong>&lt;b&gt;Ada&lt;/b&gt;</strong>,");
    expect(m.html).toContain("One click and you&#39;re in.");
    expect(m.html).toContain('href="https://x.test/v?t=1&amp;x=2"');
    // Fields left alone keep the built-in wording.
    expect(m.html).toContain("Verify your email address");
    expect(m.html).toContain("This link expires in 24 hours.");
    expect(m.text).toContain("Verify Email Address: https://x.test/v?t=1&x=2");
    expect(passwordResetRequest({ firstName: "Ada", resetUrl: "https://x.test/r" }).subject).toMatch(/Reset your .* password/);
  });

  it("refuses unknown emails, fields and variables", () => {
    expect(validateSettingValue("emails.overrides", { emailVerification: { subject: "Hi {{firstName}}" } }).ok).toBe(true);
    expect(validateSettingValue("emails.overrides", { emailVerification: { subject: "Hi {{accountName}}" } }).ok).toBe(false);
    expect(validateSettingValue("emails.overrides", { nope: { subject: "x" } }).ok).toBe(false);
    expect(validateSettingValue("emails.overrides", { emailVerification: { footer: "x" } }).ok).toBe(false);
  });
});

describe("the Emails screen's API", () => {
  let f: any;
  const store: Record<string, unknown> = {};
  const sent: any[] = [];

  beforeAll(async () => {
    setEmailsMailer({ send: async (m: any) => (sent.push(m), { id: "x" }) } as never);
    f = Fastify();
    f.decorate("platformSettings", {
      get: async (k: string) => store[k],
      update: async (changes: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(changes)) {
          const c = v === null ? { ok: true } : validateSettingValue(k, v);
          if (!c.ok) throw Object.assign(new Error((c as any).error), { statusCode: 400 });
          if (v === null) delete store[k];
          else store[k] = v;
        }
        return { before: {}, after: {} };
      },
    });
    f.decorate("requireAbility", () => async (r: any) => void (r.admin = { id: "00000000-0000-4000-8000-00000000000f", email: "boss@test", isSuperAdmin: true }));
    f.setErrorHandler(errorHandler);
    await f.register(adminEmailRoutes, { prefix: "/api/v1/admin/emails" });
    await f.ready();
  });

  afterAll(async () => {
    setEmailsMailer(null);
    setEmailOverrides({});
    await f?.close();
  });

  const call = (method: string, u: string, payload?: unknown) => f.inject({ method, url: `/api/v1/admin/emails${u}`, payload }).then((r: any) => ({ status: r.statusCode as number, body: r.json() }));

  it("lists, saves, previews, tests and resets", async () => {
    const list = await call("GET", "");
    expect(list.body.data.map((e: any) => e.key)).toContain("passwordResetRequest");
    expect(list.body.data.find((e: any) => e.key === "emailVerification")).toMatchObject({ edited: false, variables: expect.objectContaining({ firstName: "Ada" }) });

    expect((await call("PUT", "/passwordResetRequest", { subject: "Reset {{accountName}}" })).status).toBe(400);
    expect((await call("PUT", "/nope", { subject: "x" })).status).toBe(404);
    const saved = await call("PUT", "/passwordResetRequest", { subject: "  Your new {{productName}} password  ", heading: "", note: "" });
    expect(saved.body.data.override).toEqual({ subject: "Your new {{productName}} password" });
    expect(passwordResetRequest({ firstName: "Ada", resetUrl: "https://x.test/r" }).subject).toBe("Your new VhyxVoid password");

    const p = await call("POST", "/passwordResetRequest/preview", { fields: { heading: "New <password>" } });
    expect(p.body.data.html).toContain("New &lt;password&gt;");
    expect(p.body.data.html).toContain("https://www.vhyxvoid.com/reset-password?token=");

    const t = await call("POST", "/passwordResetRequest/test", { fields: {} });
    expect(t.body.data.to).toBe("boss@test");
    expect(sent.at(-1).subject).toBe("[Test] Reset your VhyxVoid password");

    const reset = await call("PUT", "/passwordResetRequest", {});
    expect(reset.body.message).toMatch(/built-in/);
    expect(store["emails.overrides"]).toBeUndefined();
    expect(passwordResetRequest({ firstName: "Ada", resetUrl: "https://x.test/r" }).subject).toBe("Reset your VhyxVoid password");
  });
});
