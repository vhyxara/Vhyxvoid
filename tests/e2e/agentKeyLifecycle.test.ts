import { describe, it, expect, vi } from "vitest";
import { createHmac } from "crypto";
import { AccountStatusSweepService } from "../../apps/hub/src/services/AccountStatusSweep.service";
import { HubAuthService, secretFingerprint } from "../../apps/hub/src/services/HubAuth.service";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { PendingRegistry } from "../../apps/hub/src/registry/Pending.registry";
import { makeAgentSession } from "./testHelpers";

// Covers internal-tools/shared/audit-2026-09-24.md H3: revoking, expiring or
// rotating an API key did nothing to an agent already connected with it (the
// sweep re-checked Account.status only), an expired-but-not-yet-marked key
// could still register, and the rotation grace window didn't exist for
// agents. The sweep now re-checks each connection's key the way S4 re-checks
// its account, and evicts the same way (hub:error AUTH_FAILED, fatal, with
// the reason), and the handshake honours expiry and the grace window.

type KeyState = {
  status: string;
  expiresAt: Date | null;
  rotationGraceEndsAt: Date | null;
  secretHash?: string;
  previousSecretHash?: string | null;
};
const ACTIVE: KeyState = { status: "ACTIVE", expiresAt: null, rotationGraceEndsAt: null };

function sweepWith(keys: Record<string, KeyState>, sessionOverrides: Parameters<typeof makeAgentSession>[0] = {}) {
  const registry = new AgentRegistry();
  const ws = { send: vi.fn(), close: vi.fn() };
  registry.register(makeAgentSession({ agentId: "agt_1", accountId: "acct_1", keyId: "key_1", label: "web", ws, ...sessionOverrides }));
  const sessionRepo = {
    findStatusesByAccountIds: vi.fn(async () => new Map([["acct_1", "ACTIVE"]])),
    findKeyStatesByIds: vi.fn(async (ids: string[]) => new Map(ids.filter((i) => i in keys).map((i) => [i, keys[i]]))),
    markDisconnected: vi.fn(async () => {}),
  };
  const sweep = new AccountStatusSweepService(
    registry,
    new PendingRegistry({ set: async () => {}, del: async () => {} } as any),
    sessionRepo as any,
    { closeAllForAgent: vi.fn(() => 0) } as any,
    { del: vi.fn(async () => 1) },
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
  return { sweep, registry, ws, sessionRepo };
}

function sentError(ws: { send: ReturnType<typeof vi.fn> }) {
  return JSON.parse(ws.send.mock.calls[0][0]);
}

describe("the sweep re-validates each connected agent's key (H3)", () => {
  it("a key revoked mid-session is evicted on the next tick, with the reason", async () => {
    const { sweep, registry, ws, sessionRepo } = sweepWith({ key_1: { ...ACTIVE, status: "REVOKED" } });

    await sweep.tick();

    expect(sentError(ws)).toMatchObject({ type: "hub:error", code: "AUTH_FAILED", fatal: true, message: "API key has been revoked" });
    expect(ws.close).toHaveBeenCalled();
    expect(registry.findByAgentId("agt_1")).toBeUndefined();
    expect(sessionRepo.markDisconnected).toHaveBeenCalledWith("agt_1", "EVICTED");
  });

  it("a key past its expiresAt is evicted even before ExpireApiKeysWorker marks it EXPIRED", async () => {
    const { sweep, ws } = sweepWith({ key_1: { ...ACTIVE, expiresAt: new Date(Date.now() - 1000) } });

    await sweep.tick();

    expect(sentError(ws).message).toBe("API key has expired");
    expect(ws.close).toHaveBeenCalled();
  });

  it("a key marked EXPIRED, or deleted, is evicted", async () => {
    for (const [keys, message] of [
      [{ key_1: { ...ACTIVE, status: "EXPIRED" } }, "API key has expired"],
      [{}, "API key no longer exists"],
    ] as const) {
      const { sweep, ws } = sweepWith(keys as any);
      await sweep.tick();
      expect(sentError(ws).message).toBe(message);
    }
  });

  // After a rotation: secretHash = NEW_HASH, previousSecretHash = OLD_HASH.
  const OLD_HASH = "aa".repeat(32);
  const NEW_HASH = "bb".repeat(32);
  const rotated = (graceMs: number): KeyState => ({
    ...ACTIVE,
    secretHash: NEW_HASH,
    previousSecretHash: OLD_HASH,
    rotationGraceEndsAt: new Date(Date.now() + graceMs),
  });

  it("an agent still on the old secret (connected before the rotation, or since with the old one) keeps working during the grace window, then is evicted", async () => {
    const onOldSecret = { secretFingerprint: secretFingerprint(OLD_HASH) };

    const graceOpen = sweepWith({ key_1: rotated(60_000) }, onOldSecret);
    await graceOpen.sweep.tick();
    expect(graceOpen.ws.close).not.toHaveBeenCalled();

    const graceOver = sweepWith({ key_1: rotated(-1000) }, onOldSecret);
    await graceOver.sweep.tick();
    expect(sentError(graceOver.ws).message).toBe("API key was rotated and the old secret's grace period has ended");
  });

  it("an agent on the new secret is untouched when the grace window ends", async () => {
    const { sweep, ws } = sweepWith({ key_1: rotated(-1000) }, { secretFingerprint: secretFingerprint(NEW_HASH) });
    await sweep.tick();
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("an agent whose secret is neither current nor previous (rotated twice) is evicted even inside a grace window", async () => {
    const { sweep, ws } = sweepWith({ key_1: rotated(60_000) }, { secretFingerprint: secretFingerprint("cc".repeat(32)) });
    await sweep.tick();
    expect(sentError(ws).message).toBe("API key was rotated and the old secret's grace period has ended");
  });

  it("a healthy key is left alone, and a failed key read skips only the key checks", async () => {
    const ok = sweepWith({ key_1: ACTIVE });
    await ok.sweep.tick();
    expect(ok.ws.close).not.toHaveBeenCalled();

    const broken = sweepWith({});
    broken.sessionRepo.findKeyStatesByIds.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await broken.sweep.tick();
    expect(broken.ws.close).not.toHaveBeenCalled();
  });
});

describe("the agent handshake honours expiry and the rotation grace window (H3)", () => {
  const PEPPER = "p".repeat(32);
  const hash = (raw: string) => createHmac("sha256", PEPPER).update(raw).digest("hex");
  const OLD = "old-raw-secret";
  const NEW = "new-raw-secret";

  function auth(key: Record<string, unknown>) {
    const row = {
      secretHash: hash(NEW),
      accountId: "acct_1",
      scopes: ["tunnel:connect"],
      status: "ACTIVE",
      accountStatus: "ACTIVE",
      ...key,
    };
    return new HubAuthService({} as any, PEPPER, async () => row as any);
  }
  const register = (svc: HubAuthService, rawSecret: string) =>
    svc.authenticateAgent({ v: "1", type: "agent:register", keyId: "vhyxvoid_dev_x", rawSecret, label: "web", agentVersion: "1" } as any, "127.0.0.1");

  it("during the grace window the old secret is accepted", async () => {
    const svc = auth({ previousSecretHash: hash(OLD), rotationGraceEndsAt: Date.now() + 60_000 });
    // Each connection remembers which stored secret it matched.
    await expect(register(svc, OLD)).resolves.toMatchObject({ secretFingerprint: secretFingerprint(hash(OLD)) });
    await expect(register(svc, NEW)).resolves.toMatchObject({ secretFingerprint: secretFingerprint(hash(NEW)) });
  });

  it("after the grace window the old secret is rejected", async () => {
    const svc = auth({ previousSecretHash: hash(OLD), rotationGraceEndsAt: Date.now() - 1000 });
    await expect(register(svc, OLD)).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    await expect(register(svc, NEW)).resolves.toBeDefined();
  });

  it("an expired key can't register, even while still marked ACTIVE", async () => {
    const svc = auth({ expiresAt: Date.now() - 1000 });
    await expect(register(svc, NEW)).rejects.toMatchObject({ code: "AUTH_FAILED", message: "API key has expired" });
  });

  it("a key with a future expiry still registers", async () => {
    const svc = auth({ expiresAt: Date.now() + 60_000 });
    await expect(register(svc, NEW)).resolves.toBeDefined();
  });
});
