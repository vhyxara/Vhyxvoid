# VhyxVoid

# The Hub — Complete Design

## Hub Internal Architecture

┌────────────────────────────────────────────────────────────-─┐
│ HUB PROCESS │
│ │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────-─┐ │
│ │ WS Server │ │ AgentRegistry│ │ PendingRegistry│ │
│ │ (port 3001) │───▶│ accountId → │ │ requestId → │ │
│ │ │ │ label → │ │ { resolve, │ │
│ └──────────────┘ │ AgentSession│ │ reject, │ │
│ │ └──────────────┘ │ timeout } │ │
│ │ │ └───────────────-┘ │
│ ▼ ▼ │ │
│ ┌──────────────┐ ┌──────────────┐ │ │
│ │ MessageRouter│ │ HeartbeatSvc │ ┌───────────────┐ │
│ │ │ │ (10s loop) │ │ Redis Backing │ │
│ └──────────────┘ └──────────────┘ │ hub:pending:\* │ │
│ │ └───────────────┘ │
│ ▼ │
│ ┌──────────────┐ ┌──────────────┐ ┌───────────────┐ │
│ │ HubAuthSvc │ │ HubUsageSvc │ │ RedisPubSub │ │
│ │ (calls │ │ (calls │ │ (cross-hub │ │
│ │ ValidateKey │ │ incr usage) │ │ routing stub)│ │
│ │ UseCase) │ │ │ │ │ │
│ └──────────────┘ └──────────────┘ └───────────────┘ │
└─────────────────────────────────────────────────────────────-┘
↑ shared code import (no HTTP)
│
┌─────────────────┐
│ packages/shared │
│ - PrismaClient │
│ - RedisClient │
│ - ValidateKey │
│ UseCase │
└─────────────────┘

# The Agent Package — Complete Design

## Agent State Machine

                    ┌─────────────┐
                    │  IDLE       │ ← initial state
                    └──────┬──────┘
                           │ start()
                           ▼
                    ┌─────────────┐
               ┌───│ CONNECTING  │◀──────────────────────┐
               │   └──────┬──────┘                       │
               │          │ WS open                      │
               │          ▼                              │
               │   ┌─────────────┐                       │
               │   │AUTHENTICATING│ ← sends agent:register│
               │   └──────┬──────┘                       │
               │          │ hub:registered received       │
               │          ▼                              │
               │   ┌─────────────┐                       │
               │   │  CONNECTED  │ ← normal operation    │
               │   └──────┬──────┘                       │
               │          │ WS close / error              │
               │          ▼                              │
               │   ┌─────────────┐   replayQueue()       │
               └──▶│RECONNECTING │──────────────────────-┘
                   └─────────────┘  exponential backoff:
                                    1s → 2s → 4s → 8s → ... → 300s

# Flow

USER installs agent:
npx @vhyxvoid/agent --key vhyxvoid_dev_abc --port 3000 --label "api"

Agent starts:
AgentClient.start()
→ CONNECTING
→ WS opens to wss://hub.yourplatform.com:3001/ws
→ sends { type: "agent:register", keyId: "vhyxvoid_dev_abc", label: "api", signature: "..." }

Hub receives agent:register:
→ HubAuthService.authenticateAgent()
→ ValidateApiKeyUseCase.execute({ keyId, scope: "tunnel:connect" })
→ Redis cache lookup (sub-1ms)
→ [cache miss] Postgres SELECT + cache warm (~3ms)
→ returns { accountId: "acc_123", scopes: [...] }
→ AgentRegistry.register({ accountId: "acc_123", label: "api", ws })
→ TunnelSessionRepo.upsert({ accountId, label, status: "CONNECTED" })
→ Redis SET hub:agent:acc_123:api = hubInstanceId (TTL 25s)
→ sends { type: "hub:registered", agentId: "agt_xyz", accountId: "acc_123" }

Agent receives hub:registered:
→ state = CONNECTED
→ heartbeat.start()
→ replayQueue() (likely empty on fresh start)

DEVELOPER writes frontend code:
const tunnel = new TunnelClient({ hubUrl, keyId: "vhyxvoid_dev_abc", secret: "raw_secret", label: "api" })
await tunnel.connect()
const res = await tunnel.post('/api/users', { name: 'Alice' })

SDK sends sdk:request to Hub:
{ type: "sdk:request", keyId, requestId: "req_001", ts, signature, label: "api",
method: "POST", path: "/api/users", body: '{"name":"Alice"}' }

Hub receives sdk:request:
→ HubAuthService.authenticateRequest() → same ValidateApiKeyUseCase
→ Scope check: has tunnel:connect ✓
→ AgentRegistry.find("acc_123", "api") → found ✓
→ Size check: 50 bytes < 10MB ✓
→ PendingRegistry.enqueue({ requestId: "req_001", ... })
→ in-memory Map entry
→ Redis SET hub:pending:req_001 (TTL 32s)
→ 30s timeout timer started
→ agent.ws.send({ type: "tunnel:forward", requestId: "req_001", method: "POST", path: "/api/users", body: ... })
→ UsageService.increment(accountId, keyId, "requests", 1)

Agent receives tunnel:forward:
→ BackendProxy.forward({ method: "POST", path: "/api/users", body })
→ axios.post("http://127.0.0.1:3000/api/users", { name: "Alice" })
→ local backend processes, returns { status: 201, body: { id: "user_1" } }
→ MessageBatcher.add({ type: "tunnel:response", requestId: "req_001", status: 201, body: ... })
→ [50ms later] MessageBatcher.flush()
→ ws.send({ type: "agent:batch", messages: [{ type: "tunnel:response", ... }] })

Hub receives agent:batch:
→ handleBatch → handleTunnelResponse
→ PendingRegistry.resolve("req_001", { status: 201, body: ... })
→ clearTimeout(timer)
→ pending.resolve({ status: 201, body: { id: "user_1" } })
→ Redis DEL hub:pending:req_001
→ TunnelRequestRepo.create({ requestId: "req_001", status: 201, durationMs: 12 })

SDK receives sdk:response:
→ pending.get("req_001").resolve({ status: 201, body: { id: "user_1" } })
→ tunnel.post() returns { status: 201, body: { id: "user_1" } }
→ developer's code continues

Total round-trip latency: ~15-30ms on localhost
(1ms auth cache hit + <1ms routing + ~10ms local HTTP + ~2ms WS overhead)

# What we are transferring

Agent → Hub → Frontend:
HTTP response body (any content type — JSON, HTML, binary, images)
HTTP headers (key-value strings)
Status code (integer)
Metadata (requestId, durationMs, timestamps)

Frontend → Hub → Agent:
HTTP request body (JSON, form data, potentially binary)
HTTP headers
Method, path, query string
Auth fields (keyId, signature, timestamp)

# Time And Latency

WS network to hub: 1-5ms
ValidateApiKeyUseCase: 1-3ms (Redis cache hit)
WS network to agent: 1-5ms
HTTP to local backend: 5-50ms ← THIS IS YOUR BOTTLENECK
WS back to hub: 1-5ms
WS back to SDK: 1-5ms

JSON serialization: 0.05-0.5ms ← invisible
Protobuf serialization: 0.01-0.1ms ← still invisible

## Total: 10-70ms

### Actual 5-20ms

SDK → Hub WS send: ~0.1ms (serialization + kernel write)
Hub network receive: ~1-3ms (depends on geographic distance)
Hub: deserialize + auth: ~1-3ms (Redis cache hit = 1ms)
Hub: route + forward to agent: ~0.1ms
Hub → Agent WS send: ~1-3ms (same network)
Agent: deserialize: ~0.1ms
Agent → localhost HTTP: ~0.5ms (loopback, not network — nearly free)
Agent: serialize response: ~0.1ms
Agent → Hub WS: ~1-3ms
Hub: resolve pending: ~0.1ms
Hub → SDK WS: ~1-3ms
SDK: deserialize: ~0.1ms
─────────────────────────────────────

## Total tunnel overhead: ~6-18ms

### Solution

Small payloads (<= 64KB, most API responses):
→ Go through WebSocket message bus as base64 JSON
→ Fast, simple, works today

Large payloads (> 64KB, file uploads, images):
→ Hub issues a signed S3 pre-signed URL
→ Agent uploads directly to S3
→ Hub tells SDK: "fetch from this URL"
→ SDK downloads directly from S3

OR for truly large streaming:
→ Hub issues a direct HTTP tunnel URL (future feature)
→ Client streams directly, no buffering in hub memory

## The Correct Latency Model After Optimizations

Scenario 1: Dev using local agent (most common dev use case)
SDK → LocalAgentDiscovery (50ms timeout, <1ms response)
SDK → Agent direct HTTP (localhost)
Total tunnel overhead: < 1ms

Scenario 2: SDK and Agent in same region (production, same datacenter)
Regional Hub routing
SDK → Hub: ~2ms
Hub → Agent: ~2ms  
 Agent → Hub: ~2ms
Hub → SDK: ~2ms
Hub processing: ~1ms (auth cache hit)
Total tunnel overhead: ~9ms

Scenario 3: SDK and Agent cross-region (worst case)
US SDK → US Hub → EU Agent (cross-region pub/sub)
SDK → Hub: ~5ms
Hub → Hub pub/sub: ~30ms (cross-Atlantic)
Hub → Agent: ~5ms
Return: ~40ms
Total tunnel overhead: ~80ms
(user should be warned to use same region)
