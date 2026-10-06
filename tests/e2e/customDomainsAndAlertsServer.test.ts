// Server pieces of custom domains and alerts: hub domain lookup, traffic
// stats batching, the alert webhook's address guard, email escaping.
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomDomainResolver } from "../../apps/hub/src/services/CustomDomainResolver.service";
import { TrafficStatsService } from "../../apps/hub/src/services/TrafficStats.service";
import { isPrivateAddress, validateWebhookUrl } from "../../apps/api/src/modules/platform/alerts/webhook";
import { accountInvitation, alertNotification, escapeHtml } from "../../apps/api/src/modules/notification/infrastructure/email/templates";

describe("CustomDomainResolver", () => {
  const prisma = (row: unknown) => ({ customDomain: { findFirst: vi.fn(async () => row) } });

  it("only looks up hostnames that could be a customer's", () => {
    const r = new CustomDomainResolver(prisma(null), "vhyxvoid.com");
    for (const h of ["hub.vhyxvoid.com", "vhyxvoid.com", "acme--app.vhyxvoid.com", "127.0.0.1", "hub", "localhost", "x.localhost"]) expect(r.isCandidate(h), h).toBe(false);
    expect(r.isCandidate("api.acme.dev")).toBe(true);
  });

  it("resolves verified domains and caches answers", async () => {
    const p = prisma({ accountId: "a1", label: "web", account: { slug: "acme", status: "ACTIVE" } });
    let now = 0;
    const r = new CustomDomainResolver(p, "vhyxvoid.com", () => now);
    expect(await r.resolve("api.acme.dev")).toEqual({ accountId: "a1", label: "web", accountSlug: "acme" });
    await r.resolve("api.acme.dev");
    expect(p.customDomain.findFirst).toHaveBeenCalledTimes(1);
    expect(p.customDomain.findFirst.mock.calls[0][0].where).toMatchObject({ hostname: "api.acme.dev", verifiedAt: { not: null } });
    r.invalidate("api.acme.dev");
    await r.resolve("api.acme.dev");
    expect(p.customDomain.findFirst).toHaveBeenCalledTimes(2);
    now = 61_000;
    await r.resolve("api.acme.dev");
    expect(p.customDomain.findFirst).toHaveBeenCalledTimes(3);
  });

  it("deleted accounts and lookup failures route nowhere", async () => {
    expect(await new CustomDomainResolver(prisma({ accountId: "a", label: "x", account: { slug: "s", status: "DELETED" } }), "v.com").resolve("a.b.dev")).toBeNull();
    const failing = { customDomain: { findFirst: vi.fn(async () => { throw new Error("db down"); }) } };
    const r = new CustomDomainResolver(failing, "v.com");
    expect(await r.resolve("a.b.dev")).toBeNull();
    await r.resolve("a.b.dev");
    expect(failing.customDomain.findFirst).toHaveBeenCalledTimes(2); // failures are not cached
  });
});

describe("TrafficStatsService", () => {
  it("counts per tunnel per minute and writes one upsert", async () => {
    const sql: unknown[][] = [];
    const prisma = { $executeRawUnsafe: vi.fn(async (...a: unknown[]) => (sql.push(a), 1)) };
    const s = new TrafficStatsService(prisma, () => 120_500);
    s.record("a", "web", 200, 10);
    s.record("a", "web", 503, 30);
    s.record("a", "web", 404, 5);
    s.record("a", "api", 200, 1);
    expect(await s.flush()).toBe(2);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const [text, ...values] = sql[0] as [string, ...unknown[]];
    expect(text).toMatch(/ON CONFLICT \("accountId", "label", "minute"\) DO UPDATE/);
    expect(values.slice(0, 7)).toEqual(["a", "web", new Date(120_000), 3, 1, 1, 45n]);
    expect(await s.flush()).toBe(0);
  });

  it("keeps the counts when the write fails", async () => {
    const prisma = { $executeRawUnsafe: vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(1) };
    const s = new TrafficStatsService(prisma, () => 0);
    s.record("a", "web", 200, 1);
    await expect(s.flush()).rejects.toThrow("down");
    expect(await s.flush()).toBe(1);
  });
});

describe("alert webhook guard", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("private, loopback, link-local and mapped addresses are private", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.5", "192.168.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("production: https only, no credentials, no internal targets", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(validateWebhookUrl("https://hooks.slack.com/services/x")).toBeUndefined();
    expect(validateWebhookUrl("http://hooks.slack.com/x")).toMatch(/https/);
    expect(validateWebhookUrl("https://user:pw@example.com/")).toMatch(/credentials/);
    expect(validateWebhookUrl("https://169.254.169.254/latest")).toMatch(/not reachable/);
    expect(validateWebhookUrl("https://metadata.internal/")).toMatch(/not reachable/);
    expect(validateWebhookUrl("https://example.com:6379/")).toMatch(/port/);
    expect(validateWebhookUrl("not a url")).toMatch(/valid/);
  });
});

describe("email escaping", () => {
  it("names cannot inject HTML", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    const mail = accountInvitation({ inviterName: "Eve", accountName: '<a href="https://evil">Click</a>', roleLabel: "Admin", inviteUrl: "https://app/x?a=1&b=2", expiresInDays: 3 } as never);
    expect(mail.html).not.toContain('<a href="https://evil">');
    expect(mail.html).toContain("&lt;a href=&quot;https://evil&quot;&gt;");
    expect(mail.subject).toContain('<a href="https://evil">Click</a>'); // subjects are plain text
  });

  it("alert emails escape rule and tunnel names", () => {
    const m = alertNotification({ kind: "FIRING", title: "Tunnel <b>x</b> is offline", message: "line1\nline2", accountName: "Acme", ruleName: "<script>", url: "https://app/o" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("line1<br>line2");
    expect(m.subject).toBe("[Alert] Tunnel <b>x</b> is offline — Acme");
  });
});
