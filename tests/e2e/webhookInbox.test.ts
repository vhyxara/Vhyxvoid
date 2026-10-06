// Webhook inbox: delivery rules (packages/shared/src/inbox.ts) and the hub's
// drain loop (apps/hub InboxService) against an in-memory store.
import { afterEach, describe, expect, it } from "vitest";

import {
  deliveryOutcome,
  inboxBackoffMs,
  inboxStoredHeaders,
  INBOX_MAX_ATTEMPTS,
  installSettingsReader,
  isInboxMethod,
  SettingsReader,
} from "../../packages/shared/src";
import { InboxService } from "../../apps/hub/src/services/Inbox.service";

afterEach(() => installSettingsReader(null));

describe("delivery rules", () => {
  it("the app's answer below 500 is delivered, even 4xx", () => {
    expect(deliveryOutcome(200, null, 1).state).toBe("DELIVERED");
    expect(deliveryOutcome(400, null, 1).state).toBe("DELIVERED");
  });

  it("offline / rate limited pauses without counting", () => {
    expect(deliveryOutcome(404, "TUNNEL_OFFLINE", 1).state).toBe("PAUSED");
    expect(deliveryOutcome(429, "RATE_LIMITED", 1).state).toBe("PAUSED");
    expect(deliveryOutcome(null, null, 1).state).toBe("PAUSED");
  });

  it("the app's 5xx or an unreachable app retries with backoff, then fails", () => {
    const r = deliveryOutcome(500, null, 1, 0);
    expect(r).toMatchObject({ state: "RETRY" });
    expect((r as any).nextAttemptAt.getTime()).toBe(30_000);
    expect(deliveryOutcome(504, "AGENT_TIMEOUT", 2).state).toBe("RETRY");
    expect(deliveryOutcome(502, null, INBOX_MAX_ATTEMPTS).state).toBe("FAILED");
    expect(inboxBackoffMs(20)).toBe(3_600_000);
  });

  it("only writes are held, and hop-by-hop headers are not stored", () => {
    expect(isInboxMethod("post")).toBe(true);
    expect(isInboxMethod("GET")).toBe(false);
    expect(inboxStoredHeaders({ Host: "h", "Content-Length": "3", "Stripe-Signature": "t=1", "x-vhyxvoid-internal": "s" })).toEqual({ "stripe-signature": "t=1" });
  });
});

// ── In-memory prisma ──────────────────────────────────────────────────────────
function store() {
  let seq = 0;
  const rows: any[] = [];
  const match = (r: any, w: any = {}) =>
    Object.entries(w).every(([k, v]: [string, any]) => {
      if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
      if (v && typeof v === "object" && "not" in v) return r[k] !== v.not;
      if (v && typeof v === "object" && "lt" in v) return r[k] < v.lt;
      if (v && typeof v === "object" && "lte" in v) return r[k] <= v.lte;
      return r[k] === v;
    });
  const apply = (r: any, data: any) => {
    for (const [k, v] of Object.entries(data) as [string, any][]) r[k] = v && typeof v === "object" && "increment" in v ? r[k] + v.increment : v;
    r.updatedAt = new Date();
  };
  const prisma = {
    account: { findUnique: async () => ({ slug: "acme", status: "ACTIVE", id: "acc" }) },
    tunnelInbox: { findUnique: async () => ({ enabled: true }) },
    inboxRequest: {
      count: async ({ where }: any) => rows.filter((r) => match(r, where)).length,
      create: async ({ data }: any) => {
        const r = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, status: "QUEUED", attempts: 0, nextAttemptAt: new Date(0), receivedAt: new Date(seq), ...data };
        rows.push(r);
        return { id: r.id };
      },
      findFirst: async ({ where }: any) => rows.filter((r) => match(r, where)).sort((a, b) => a.receivedAt - b.receivedAt)[0] ?? null,
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => apply(r, data));
        return { count: hit.length };
      },
      update: async ({ where, data }: any) => apply(rows.find((r) => r.id === where.id), data),
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    },
  };
  return { prisma, rows };
}

function service(answers: Array<{ status: number | null; hubError: string | null }>, opts: { connected?: boolean; keep?: number } = {}) {
  const s = store();
  const sent: string[] = [];
  const svc = new InboxService({
    prisma: s.prisma,
    limits: { findPlanLimitsForAccount: async () => ({ plan: "FREE" as const, inboxRequests: opts.keep ?? 25 }) },
    isConnected: () => opts.connected ?? true,
    hubPort: 0,
    hubDomain: "vv.test",
    secret: () => "x",
    send: async (r) => {
      sent.push(`${r.host} ${r.method} ${r.path}`);
      return answers.shift() ?? { status: 200, hubError: null };
    },
  });
  return { svc, sent, rows: s.rows };
}

const req = (path: string) => ({ method: "POST", path, headers: { "content-type": "application/json" }, body: Buffer.from("{}") });

describe("InboxService", () => {
  it("stores up to the plan limit, then reports full", async () => {
    const { svc } = service([], { keep: 2 });
    expect((await svc.tryStore("acc", "app", req("/1"))).stored).toBe(true);
    expect((await svc.tryStore("acc", "app", req("/2"))).stored).toBe(true);
    expect(await svc.tryStore("acc", "app", req("/3"))).toEqual({ stored: false, reason: "full" });
  });

  it("is off when the global switch is off", async () => {
    installSettingsReader(new SettingsReader(async () => [{ key: "features.webhookInbox", value: false }]));
    const { svc } = service([]);
    expect(await svc.tryStore("acc", "app", req("/1"))).toEqual({ stored: false, reason: "disabled" });
  });

  it("delivers oldest first through the tunnel host", async () => {
    const { svc, sent, rows } = service([]);
    await svc.tryStore("acc", "app", req("/first"));
    await svc.tryStore("acc", "app", req("/second"));
    expect(await svc.drain("acc", "app")).toBe(2);
    expect(sent).toEqual(["acme--app.vv.test POST /first", "acme--app.vv.test POST /second"]);
    expect(rows.map((r) => r.status)).toEqual(["DELIVERED", "DELIVERED"]);
  });

  it("an app error stops the drain so later requests do not overtake", async () => {
    const { svc, sent, rows } = service([{ status: 500, hubError: null }]);
    await svc.tryStore("acc", "app", req("/first"));
    await svc.tryStore("acc", "app", req("/second"));
    expect(await svc.drain("acc", "app")).toBe(0);
    expect(sent).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "QUEUED", attempts: 1, lastError: "Your app answered 500" });
    expect(rows[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(rows[1].status).toBe("QUEUED");
  });

  it("tunnel gone again pauses without using an attempt", async () => {
    const { svc, rows } = service([{ status: 404, hubError: "TUNNEL_OFFLINE" }]);
    await svc.tryStore("acc", "app", req("/first"));
    await svc.drain("acc", "app");
    expect(rows[0]).toMatchObject({ status: "QUEUED", attempts: 0 });
  });

  it("does nothing while the tunnel is not connected", async () => {
    const { svc, sent } = service([], { connected: false });
    await svc.tryStore("acc", "app", req("/first"));
    expect(await svc.drain("acc", "app")).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("gives up after the last attempt", async () => {
    const { svc, rows } = service([{ status: 503, hubError: null }]);
    await svc.tryStore("acc", "app", req("/first"));
    rows[0].attempts = INBOX_MAX_ATTEMPTS - 1;
    await svc.drain("acc", "app");
    expect(rows[0].status).toBe("FAILED");
  });
});
