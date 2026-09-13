// ─────────────────────────────────────────────────────────────────────────────
// tests/e2e/testHelpers.ts
// Shared fixtures for the Hub/agent test suite. Consolidated 2026-09-12
// (broken-test-repair session) after noticing the same two patterns
// duplicated inline across files: a fake AgentSession builder (Hub audit's
// agentRegistry.test.ts) and a real local HTTP server standing in for a
// tunneled backend (Hub audit's backendProxyBodyEncoding.test.ts). Not
// picked up by vitest itself — doesn't match the "*.test.ts" include glob.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentSession } from "../../apps/hub/src/registry/Agent.registry";

export function makeAgentSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    agentId: "agt_1",
    accountId: "acct_1",
    keyId: "key_1",
    label: "default",
    ws: { send: () => {}, close: () => {} },
    connectedAt: new Date(),
    lastSeenAt: new Date(),
    missedPings: 0,
    agentVersion: "1.0.0",
    ip: "127.0.0.1",
    ...overrides,
  };
}

export type FakeBackendHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface FakeBackendServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Starts a real local HTTP server on an ephemeral port to stand in for a
 * tunneled local backend. Used instead of mocking axios: axios is resolved
 * separately inside packages/agent's own node_modules under pnpm's
 * per-package layout, so a root-level vi.mock("axios") does not reliably
 * intercept the copy BackendProxy actually loads (confirmed empirically
 * during the Hub audit session — see decision.md, 2026-09-12,
 * "bodyEncoding").
 */
export async function startFakeBackendServer(
  onRequest: FakeBackendHandler,
): Promise<FakeBackendServer> {
  const server: Server = createServer(onRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
