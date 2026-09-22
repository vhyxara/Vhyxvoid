import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageRouter } from "../../apps/hub/src/router/Message.router";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { TunnelSessionRepository } from "../../apps/hub/src/repositories/TunnelSession.repository";

// Covers shared/context.md Known Risk #57 (E1) and shared/decision.md,
// 2026-09-22, session S3. The hub applied PLAN_AGENT_LIMITS.PRO (5) to every
// account, whatever its plan, and counted the very session a same-label
// reconnect would replace.
//
// The router here is the real MessageRouter, the registry the real
// AgentRegistry, and the session repository the real TunnelSessionRepository
// (so the real shared plan resolver runs) over a fake Prisma holding accounts
// and subscriptions. Only the auth service and the sockets are faked.

type AccountFixture = { status?: string; plan?: string | null };

function makeHub(accounts: Record<string, AccountFixture>, opts: { failPlanLookup?: boolean } = {}) {
  const prisma = {
    apiKey: {
      // key ids are "key_<accountId>_<n>"; the account is the middle part
      findUnique: async ({ where }: any) => {
        const accountId = String(where.keyId).split("_").slice(1, -1).join("_");
        return { id: `uuid_${where.keyId}`, accountId };
      },
    },
    account: {
      findUnique: async ({ where, select }: any) => {
        if (opts.failPlanLookup && select.status) throw new Error("db down");
        const a = accounts[where.id];
        if (!a) return null;
        return select.slug ? { slug: where.id } : { status: a.status ?? "ACTIVE" };
      },
    },
    subscription: {
      findFirst: async ({ where }: any) => {
        const plan = accounts[where.accountId]?.plan;
        return plan ? { plan } : null;
      },
    },
    tunnelSession: { upsert: async () => {} },
  };

  const agentRegistry = new AgentRegistry();
  const router = new MessageRouter(
    agentRegistry,
    {} as any,
    { rejectAllForAgent: () => 0 } as any,
    {
      // key id "key_<account>_<n>" -> that account; the secret check is not under test
      authenticateAgent: async (msg: any) => ({
        accountId: String(msg.keyId).split("_").slice(1, -1).join("_"),
        keyId: msg.keyId,
        scopes: ["*"],
      }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    new TunnelSessionRepository(prisma as any),
    {} as any,
    "hub_1",
    { register: async () => {}, unregister: async () => {} } as any,
    "vhyxvoid.com",
    { closeAllForAgent: () => {} } as any,
  );

  let n = 0;
  /** One agent connection attempt. Returns what the hub sent back. */
  async function connect(accountId: string, label: string) {
    const sent: any[] = [];
    let closed = false;
    const ws = {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw)),
      close: () => {
        closed = true;
      },
    };
    const msg = {
      v: "1",
      type: "agent:register",
      keyId: `key_${accountId}_${++n}`,
      label,
      rawSecret: "s",
      agentVersion: "1.0.0",
    };
    await router.routeAgentMessage(ws, Buffer.from(JSON.stringify(msg)), "127.0.0.1");
    const reply = sent.find((m) => m.type === "hub:registered" || m.type === "hub:error");
    return {
      accepted: reply?.type === "hub:registered",
      error: reply?.type === "hub:error" ? reply : null,
      closed,
    };
  }

  return { connect, agentRegistry };
}

afterEach(() => vi.restoreAllMocks());

describe("hub agent limit follows the account's real plan", () => {
  it("FREE (no subscription): the first agent connects, a second concurrent agent is refused", async () => {
    const hub = makeHub({ free1: {} });

    expect((await hub.connect("free1", "web")).accepted).toBe(true);
    const second = await hub.connect("free1", "api");

    expect(second.accepted).toBe(false);
    expect(second.error).toMatchObject({
      code: "AGENT_LIMIT_REACHED",
      fatal: true,
      message: "Maximum 1 agent allowed on your FREE plan",
    });
    expect(second.closed).toBe(true);
    expect(hub.agentRegistry.countByAccount("free1")).toBe(1);
  });

  it("FREE: reconnecting the SAME label is not refused, and does not leave two sessions", async () => {
    const hub = makeHub({ free1: {} });
    await hub.connect("free1", "web");

    // The old socket has not been evicted yet (missed heartbeats take ~90 s).
    const reconnect = await hub.connect("free1", "web");

    expect(reconnect.accepted).toBe(true);
    expect(hub.agentRegistry.countByAccount("free1")).toBe(1);
  });

  it("FREE: after a reconnect the limit still blocks a genuinely different second agent", async () => {
    const hub = makeHub({ free1: {} });
    await hub.connect("free1", "web");
    await hub.connect("free1", "web");

    expect((await hub.connect("free1", "api")).accepted).toBe(false);
  });

  it("FREE: two registrations racing each other cannot both get in", async () => {
    const hub = makeHub({ free1: {} });

    const results = await Promise.all([hub.connect("free1", "a"), hub.connect("free1", "b")]);

    expect(results.filter((r) => r.accepted)).toHaveLength(1);
    expect(hub.agentRegistry.countByAccount("free1")).toBe(1);
  });

  it("PRO allows 5 agents and refuses the 6th", async () => {
    const hub = makeHub({ pro1: { plan: "PRO" } });

    for (let i = 1; i <= 5; i++) {
      expect((await hub.connect("pro1", `l${i}`)).accepted, `agent ${i}`).toBe(true);
    }
    const sixth = await hub.connect("pro1", "l6");

    expect(sixth.accepted).toBe(false);
    expect(sixth.error?.message).toBe("Maximum 5 agents allowed on your PRO plan");
  });

  it("PRO: reconnecting a label while at the limit is accepted", async () => {
    const hub = makeHub({ pro1: { plan: "PRO" } });
    for (let i = 1; i <= 5; i++) await hub.connect("pro1", `l${i}`);

    expect((await hub.connect("pro1", "l3")).accepted).toBe(true);
    expect(hub.agentRegistry.countByAccount("pro1")).toBe(5);
  });

  it("ENTERPRISE has no agent limit (well past the PRO figure of 5)", async () => {
    const hub = makeHub({ ent1: { plan: "ENTERPRISE" } });

    for (let i = 1; i <= 12; i++) {
      expect((await hub.connect("ent1", `l${i}`)).accepted, `agent ${i}`).toBe(true);
    }
  });

  it("limits belong to each account: a PRO account's headroom is not FREE's, and FREE's cap is not PRO's", async () => {
    const hub = makeHub({ free1: {}, pro1: { plan: "PRO" }, ent1: { plan: "ENTERPRISE" } });

    expect((await hub.connect("free1", "web")).accepted).toBe(true);
    expect((await hub.connect("free1", "api")).accepted).toBe(false); // FREE full
    for (let i = 1; i <= 3; i++) expect((await hub.connect("pro1", `l${i}`)).accepted).toBe(true);
    for (let i = 1; i <= 7; i++) expect((await hub.connect("ent1", `l${i}`)).accepted).toBe(true);
    expect((await hub.connect("free1", "again")).accepted).toBe(false);
  });

  it("PAST_DUE keeps its real plan's limit (the grace period)", async () => {
    const hub = makeHub({ late: { status: "PAST_DUE", plan: "PRO" } });

    for (let i = 1; i <= 5; i++) expect((await hub.connect("late", `l${i}`)).accepted).toBe(true);
  });

  it("a SUSPENDED account with a PRO subscription gets the FREE limit", async () => {
    const hub = makeHub({ gone: { status: "SUSPENDED", plan: "PRO" } });

    expect((await hub.connect("gone", "a")).accepted).toBe(true);
    expect((await hub.connect("gone", "b")).accepted).toBe(false);
  });

  it("if the plan lookup fails, the previous behavior (the PRO limit) applies and the failure is logged", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const hub = makeHub({ free1: {} }, { failPlanLookup: true });

    for (let i = 1; i <= 5; i++) expect((await hub.connect("free1", `l${i}`)).accepted).toBe(true);
    expect((await hub.connect("free1", "l6")).accepted).toBe(false);
    expect(errors.mock.calls.some((c) => String(c[1]).includes("plan lookup failed"))).toBe(true);
  });
});
