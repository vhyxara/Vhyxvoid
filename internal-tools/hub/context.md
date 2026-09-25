# Project Context — apps/hub

**Scope:** apps/hub, the tunnel router (WS server) — registries, message routing, auth, subdomain registry, pubsub. See `internal-tools/shared/context.md` for the monorepo-wide Architecture diagram, the Agent/SDK auth-path-divergence note, and cross-cutting flows (tunneled HTTP request, local discovery, API key validation) — not duplicated here.

Migrated 2026-09-17 from the monorepo's single `.claude/context.md`.

## Tech Stack

- **Hub (tunnel router)**: plain Node `http` module + `ws` (WebSocketServer in `noServer` mode) — `fastify`, `uWebSockets.js`, and `pg` are also listed as dependencies but are confirmed leftovers from two earlier rewrite attempts (uWebSockets.js → Fastify → plain http+ws), safe to remove. Imports `packages/shared`'s Prisma client directly (no HTTP call to the API).

## Directory Structure

```
apps/hub/       Tunnel router: WS server, registries, message router, auth, pubsub
    src/router/       Message.router.ts — dispatches by WS message type
    src/services/     HubAuth, HubUsage, Heartbeat, HubPubSub (stub), SubdomainRegistry
    src/repositories/ TunnelSession / TunnelRequest writes (via packages/shared's Prisma)
    prisma/schemaprisma.ts   NOT a real schema — stale dead Prisma model comments
```

## Core Flows

### Agent Registration & Handshake

The Agent daemon authenticates itself to the Hub with a raw shared secret (not the canonical-signature scheme used elsewhere) before it can receive tunneled traffic. This split is intentional (see Architecture).

```mermaid
sequenceDiagram
    participant CLI as agent CLI
    participant AC as AgentClient
    participant Hub as Hub (WS)
    participant Auth as HubAuthService
    participant Store as Postgres/Redis

    CLI->>AC: start() — state: IDLE -> CONNECTING
    AC->>Hub: WS connect
    AC->>Hub: agent:register {keyId, label, rawSecret, agentVersion}
    Hub->>Auth: authenticateAgent(keyId, rawSecret)
    Auth->>Store: load ApiKey (Redis cache, else Postgres + warm cache)
    Auth->>Auth: HMAC-SHA256(pepper, rawSecret) vs secretHash (timingSafeEqual)
    Auth-->>Hub: {accountId, scopes} or reject
    Hub->>Store: TunnelSession.upsert(status=CONNECTED)
    Hub->>Store: Redis SET hub:agent:{accountId}:{label} = hubInstanceId (TTL 25s)
    Hub-->>AC: hub:registered {agentId, accountId, replayPending}
    AC->>AC: state = CONNECTED; start heartbeat; replayQueue()
```

Side effects/non-obvious behavior: on WS close/error the Agent moves to `RECONNECTING` with exponential backoff (1s → 2s → 4s → ... capped at 300s); `AgentClient` never calls `LocalDiscoveryServer.setAccountIdHash()` despite receiving `accountId` in `hub:registered`, so the local-discovery account-verification feature described in code comments is not actually wired up. `hub:registered`'s `replayPending` field is **hardcoded to `false`** — the hub never actually queues inbound requests for an agent to replay; see the inbound-replay note below.

**Inbound replay — confirmed partial, not a full stub.** Outbound replay (agent queues responses while WS is down, drains them on reconnect) works correctly via `packages/agent/src/replay/replayQueue.ts`. Inbound replay (a `tunnel:forward` the hub sent while the agent was mid-reconnect) does not work: `PendingRegistry` (hub-side) holds in-flight requests with a timeout (default 30s); if the agent reconnects within that window it can still respond normally, but if it reconnects after, the request has already been rejected with `AGENT_TIMEOUT`/504 and there is nothing to replay — the agent has no way to know what it missed. If a stale-requestId response does eventually arrive from the agent, the hub silently drops it since the pending entry is gone. Net effect: for GET this is harmless (caller retries), but for POST/DELETE it's a real correctness gap — the local backend processes the mutation but the original caller already got an error. Acceptable for a dev tool today; flagged as the top reliability item before advertising "requests survive disconnects."

**Flow 2 (Tunneled HTTP Request, the main value-prop flow) and Flow 4 (API Key Validation) are documented in `internal-tools/shared/context.md`** — both span agent+hub+sdk or are shared by Hub-SDK and direct API auth.

## Configuration & Environment

Hub-specific env vars (HUB_PORT, HUB_DOMAIN, HUB_INTERNAL_SECRET, HUB_DEBUG_LOGGING) are documented in `internal-tools/shared/context.md`'s Configuration table, alongside the vars apps/hub shares with apps/api (DATABASE_URL, Redis, HMAC pepper).

## Known Risks / Gaps

Numbering is preserved from the original unified context.md so cross-references (`decision.md` entries, other component context.md files) keep working across files.

3. **DECIDED (accepted, not fixed) — Inbound replay is real but incomplete.** No longer an open "no consensus" question — decided 2026-09-12: accepted as-is for pre-launch/casual-dev-tool usage. Explicit trigger condition recorded for when to revisit: before onboarding any team relying on POST/DELETE reliability across reconnects, or before any product messaging implying "requests survive disconnects." See decision.md, 2026-09-12, "Inbound replay gap: accepted as-is for pre-launch."
7. **FIXED — Unauthenticated internal endpoint.** Fixed 2026-09-12: `POST /internal/proxy` now requires a `x-hub-internal-secret` header, checked via `crypto.timingSafeEqual` against `HUB_INTERNAL_SECRET` (new pure/tested helper: `apps/hub/src/utils/internalAuth.ts`). **Fails closed** — if `HUB_INTERNAL_SECRET` is unset (true today; correction 2026-09-13: a caller *does* exist, `POST /api/v1/tunnelproxy/request` — see item 40 — it's just that nothing calls that route yet), every request gets a 503, not silent bypass. See decision.md, 2026-09-12, "internal/proxy authentication." Tested: `tests/e2e/internalProxyAuth.test.ts`.
8. **FIXED — Debug logging leaks key material.** Fixed 2026-09-12. Deleted outright (not just gated, since these should never be printable): `HubAuth.service.ts`'s pepper-length/expectedHash/storedHash prints, and a worse, previously-unflagged line — `console.log('[hub-auth] received agent register:', JSON.stringify(msg))`, which logged the agent's **plaintext raw secret** (`msg.rawSecret`), not just a hash. Gated behind a new `HUB_DEBUG_LOGGING=true` env var (default off, `apps/hub/src/utils/debug.ts`): `Message.router.ts`'s subdomain-registration-flow lines, `AgentRegistry.register()`'s per-registration log (now logs `agentId`/`accountId`/`label` only, not the raw session/`ws` object it used to dump), and three previously-unflagged `HttpTunnelHandler.ts` lines that fired on every single incoming request/connection (`isTunnelRequest`, forward-send, browser-WS-connected). See decision.md, 2026-09-12, "Hub debug logging."
9. **DECIDED (confirmed safe, trigger condition recorded) — No horizontal Hub scaling.** `HubPubSub.ts` is still a confirmed no-op stub (unchanged). Investigated 2026-09-12 whether anything today assumes multi-hub behavior: confirmed **no** — `findAgentHub()`/`publishForward()` (the two methods that would matter) are never called anywhere; only lifecycle `start()`/`stop()` are. Safe as-is for single-instance deployment. **Recorded trigger, not open-ended**: build Phase 2 before running more than one Hub process in production for any reason, including a blue/green deploy — until then, a second instance would misroute (`AGENT_NOT_FOUND` for agents connected to the other instance), a confusing, load-balancer-dependent failure mode. See decision.md, 2026-09-12, "HubPubSub stub."
19. **FIXED (fully, 2026-09-14) — `onAgentClose` called without `await`, and the underlying cross-connection race it couldn't fix alone.** `await` added 2026-09-12 (WS close handler is `async`, awaits `router.onAgentClose(ws)` with a `try/catch`) — a genuine correctness/observability improvement but, as that session's own entry documented, not a fix for the actual race: `onAgentClose`'s async `subdomainRegistry.unregister()` and a reconnecting agent's async `subdomainRegistry.register()` for the same label run on two independent WS connections with no ordering guarantee between their Redis round-trips. **Real fix, 2026-09-14**: `SubdomainRegistry` now has (a) a per-(label,accountSlug) in-process async mutex serializing `register()`/`unregister()` for the same key (sufficient since the Hub is single-instance — `HubPubSub`/multi-hub is a confirmed stub, item 9 — no need for cross-process/Redis-level locking), and (b) `unregister()` is now a compare-and-delete (`unregister(label, accountSlug, expectedAgentId)`) rather than a blind delete — it only removes the Redis entry if it still belongs to the agentId that's disconnecting, so a stale/superseded unregister call becomes a correct no-op instead of deleting a newer, valid registration, regardless of which of the two independent async chains happens to finish first. Both real callers (`Message.router.ts`'s `onAgentClose`, and `HttpTunnelHandler`'s stale-Redis-entry cleanup path — a second, related instance of the same blind-delete pattern, fixed the same way) updated to pass the agentId they already have on hand. Tested: `tests/e2e/subdomainRegistryRace.test.ts` — every test in the file was verified to genuinely fail against the pre-fix implementation (not just pass trivially against the new one): a stale unregister no longer wipes a newer registration (both timing orderings), the mutex provably prevents concurrent Redis operations on the same key, and different labels are confirmed not serialized against each other. See decision.md, 2026-09-14, "onAgentClose cross-connection race, real fix."
20. **FIXED — `AgentRegistry.findByAgentId` is O(n).** Fixed 2026-09-12: now `return this.byAgentId.get(agentId)` — the O(1) reverse-index map was already maintained by `register()`/`evict()`, just never used by this method. Tested: `tests/e2e/agentRegistry.test.ts`.
23. **OPEN\* — `PendingRegistry` is in-memory only, description corrected; severity assessed and accepted for now.** Re-read `Pending.registry.ts` directly: it does write a Redis mirror on `enqueue()`/`resolve()`/`reject()`/`rejectAllForAgent()` (`hub:pending:{requestId}`, TTL-bound) — this predates the current audit cycle (present since the file's original April commit) and was never reflected in the prior description. However, the Redis copy stores only `{accountId, agentLabel, ts}` metadata, **not** the `resolve`/`reject` closures (bound to a live WS connection, inherently unserializable) — so a hub crash still drops every in-flight request exactly as originally described. **Assessed and decided 2026-09-12**: acceptable risk for current single-instance/pre-launch deployment (bounded, client-retriable failures, not silent data loss) — tied explicitly to the same trigger condition as item 9 (HubPubSub Phase 2), since a real fix here and horizontal-scaling support are the same piece of work. See decision.md, 2026-09-12, "PendingRegistry crash gap."
25. **FIXED, scope expanded — Unused dependencies in `apps/hub/package.json`.** Fixed 2026-09-12: removed the three originally-named (`fastify`, `uWebSockets.js`, `pg`) plus six more found to be equally unused during the same verification pass — `bcryptjs`, `jsonwebtoken`, `pino`, `ioredis`, `zod`, and all six `@fastify/*` plugins (`compress`/`cookie`/`cors`/`helmet`/`jwt`/`rate-limit`) — plus their orphaned devDependencies (`@types/pg`, `@types/jsonwebtoken`, `pino-pretty`) and the now-dead `apps/hub/src/types/uWebSockets.d.ts`. Confirmed zero real imports for all nine before removing; `pnpm install` + `pnpm --filter @vhyxvoid/hub typecheck`/`build` both pass clean after. See decision.md, 2026-09-12, "apps/hub dependency cleanup."
27. **OPEN — Stale/dead files that could mislead a reader.** No session_update.md entry claims any of these were removed — presumed unchanged. (`WsConnection.registry.ts` was deleted 2026-09-20, superseded by `TunnelWs.registry.ts` — see shared context.md #55.)
28. **OPEN — Inconsistent lint/format setup** (`apps/hub`'s legacy ESLint 8 config). Unchanged.

60. **Cross-referenced, lives in `internal-tools/shared/context.md` #60** — `HttpTunnelHandler` no longer rewrites backend cookies or owns CORS (mitigated in source 2026-09-24, `ffb80a0`, not deployed; audit C3/C4). Recorded in shared because it reverses a cross-cutting product premise.
62. **FIXED IN SOURCE 2026-09-24 (`621ee3f`, docs `6b65972`; not deployed) — revoking, expiring or rotating an API key did nothing to an agent already connected with it (audit H3).** Agents were authenticated once at `agent:register` and `AccountStatusSweepService` re-checked only `Account.status`; the handshake also ignored `expiresAt` and the rotation grace window. The sweep now re-checks each connection's key every ~60 s (one batched Postgres query) and evicts with the reason (`hub:error AUTH_FAILED`, fatal); each `AgentSession` carries `secretFingerprint`, so after a rotation an agent on the old secret is kept until the grace window ends and then evicted; `authenticateAgent` refuses expired keys and accepts the previous secret during grace. Verified live (revoke: evicted 7 s later; expiry: evicted on the next tick while still `ACTIVE` in the DB, then refused at registration; rotation: old secret kept and reconnectable during grace, evicted and refused after). No pub/sub event: see `hub/decision.md`, 2026-09-24, "H3".

## Open Questions

- ~~Why does the hub depend on fastify/uWebSockets.js/pg?~~ **Resolved: leftovers from two earlier rewrite attempts. Confirmed unused. Safe to remove.**
- ~~Does the inbound-replay gap need a real fix before any production/team use?~~ **Decided 2026-09-12: accepted as-is for now, with an explicit trigger condition for revisiting (see Known Risks #3) — no longer an open "no consensus" question.**
- ~~`Message.router.ts`'s `tunnel:ws:error` routing path — reachable or dead code?~~ **Resolved 2026-09-12: traced directly, confirmed reachable. One `HttpTunnelHandler` singleton is shared by `HubServer` and `MessageRouter` via constructor injection; no staleness.**
- **Still open, newly surfaced**: is `PendingRegistry`'s Redis mirror (item #23) used for anything beyond `HubPubSub.findAgentHub`-style cross-hub visibility, or could it be repurposed as a starting point for real crash recovery later? Not investigated in depth — noted as a possible starting point for whenever items #9/#23's shared trigger condition fires.
