// /api/v1/agents routes with a real Fastify, a fake Prisma and a fake hub.
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

import { agentRoutes } from "../../apps/api/src/modules/platform/agents/agents.routes";

const Fastify = createRequire(new URL("../../apps/api/package.json", import.meta.url))("fastify");

const ACC = "11111111-1111-4111-8111-111111111111";
const now = new Date();

async function app(role: number) {
  const hub = {
    configured: true,
    agents: vi.fn(async (accountId?: string) =>
      accountId === ACC
        ? [
            { agentId: "agt_a", accountId: ACC, keyId: "row-1", label: "web", agentVersion: "1.0.0", ip: "10.0.0.5", connectedAt: now.toISOString(), lastSeenAt: now.toISOString(), missedPings: 0, inFlight: 2, capabilities: [] },
          ]
        : [],
    ),
    disconnect: vi.fn(async () => true),
  };
  const audit: any[] = [];
  const prisma = {
    accountMember: { findUnique: async () => ({ roleLevel: role, user: { firstName: "Ada", lastName: "L", email: "ada@x.dev" } }) },
    account: { findUnique: async () => ({ slug: "acme" }) },
    tunnelSession: { findMany: async () => [] },
    apiKey: { findMany: vi.fn(async ({ where }: any) => (where.id.in.includes("row-1") ? [{ id: "row-1", keyId: "vhyxvoid_dev_x", name: "laptop", environment: "DEV", expiresAt: new Date(Date.now() + 86_400_000), status: "ACTIVE" }] : [])) },
    auditLog: { create: async (a: any) => audit.push(a.data) },
  };
  const f = Fastify();
  f.decorate("prisma", prisma);
  f.decorate("platformSettings", { get: async (k: string) => (k === "tunnels.recommendedAgentVersion" ? "1.1.0" : "") });
  f.decorate("userAuthGuard", async (req: any) => void (req.user = { userId: "u1", email: "ada@x.dev" }));
  f.setErrorHandler((err: any, _req: any, reply: any) => reply.code(err.statusCode ?? 500).send({ message: err.message }));
  await f.register(agentRoutes, { prefix: "/api/v1/agents", hub });
  await f.ready();
  return { f, hub, audit, prisma };
}

describe("agent fleet routes", () => {
  it("lists live agents with their key (matched by row id), version status and health", async () => {
    const { f, prisma } = await app(100);
    const res = await f.inject({ method: "GET", url: `/api/v1/agents/${ACC}` });
    const d = res.json().data;
    expect(prisma.apiKey.findMany.mock.calls[0][0].where).toMatchObject({ accountId: ACC, id: { in: ["row-1"] } });
    expect(d.agents[0]).toMatchObject({ label: "web", versionStatus: "outdated", health: "healthy", inFlight: 2, ip: "10.0.0.5", key: { name: "laptop", expiresSoon: true } });
    expect(d.summary).toEqual({ connected: 1, outdated: 1, unhealthy: 0, busy: 2 });
    expect(d.canManage).toBe(true);
    await f.close();
  });

  it("members see the fleet without IP addresses and cannot stop agents", async () => {
    const { f, hub } = await app(10);
    expect((await f.inject({ method: "GET", url: `/api/v1/agents/${ACC}` })).json().data.agents[0].ip).toBeNull();
    const stop = await f.inject({ method: "POST", url: `/api/v1/agents/${ACC}/agt_a/disconnect` });
    expect(stop.statusCode).toBe(403);
    expect(hub.disconnect).not.toHaveBeenCalled();
    await f.close();
  });

  it("admins stop their own agents (with a reason the agent prints), never another workspace's", async () => {
    const { f, hub, audit } = await app(100);
    const ok = await f.inject({ method: "POST", url: `/api/v1/agents/${ACC}/agt_a/disconnect` });
    expect(ok.statusCode).toBe(200);
    expect(hub.disconnect).toHaveBeenCalledWith("agt_a", "Stopped from the dashboard by Ada L");
    expect(audit[0]).toMatchObject({ action: "AGENT_STOPPED", resourceId: "web" });
    const foreign = await f.inject({ method: "POST", url: `/api/v1/agents/${ACC}/agt_other/disconnect` });
    expect(foreign.statusCode).toBe(404);
    expect(hub.disconnect).toHaveBeenCalledTimes(1);
    await f.close();
  });
});
