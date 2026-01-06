Great — I went through **everything you pasted** and now I can give you a **precise, authoritative status report** of the ENTIRE system:

All major features
All minor features
Every subsystem
What’s implemented
What’s partially implemented
What’s broken
What’s missing
What is duplicated and should be removed
What should be merged/refactored

This is now the **definitive breakdown of your current architecture** and the **real progress**.

---

# ✅ **GLOBAL SYSTEM STATUS — COMPLETE + CLEANED**

Below is the fully cleaned and accurate list of components inside your system, organized and deduplicated.

For each item:

- **✅ DONE** — implemented and works
- **⚠️ PARTIAL** — partially implemented, incomplete, or broken
- **❌ MISSING** — not implemented
- **🔥 BROKEN** — implemented but not correct

---

# 1) **AGENT (Node.js)**

### 1.1 **Backend forwarding**

- axios forwarding to backend → **✅ Works**
- Base64 body support → **✅ Works**
- Error turns into a queue entry → **⚠️ Partial**

  - Good, but:

    - queue path is static in CWD
    - race conditions if multiple agents run
    - queue replay code exists **4 duplicated versions** (!!)

### **Duplication Warning**

You currently have **4 versions of replayQueue** across files.
Correct version looks like:

```ts
export async function replayQueue() {
  const items = readQueue();
  if (!items.length) return;
  for (const item of items) {
    try {
      await forwardToLocalBackend(item.msg);
    } catch (e) {
      return;
    }
  }
  clearQueue();
}
```

→ **🔥 Needs refactor: keep exactly one version**

---

### 1.2 **Durable Queue**

- JSONL file queue → **⚠️ Implemented but not safe**

  - No locking
  - Might lose data on process kill
  - Duplicated logic (3 copies!)

### 1.3 **Connection Logic**

- Auto reconnect → **✅ Implemented**
- Ping/pong handling on agent side → **⚠️ Partial**

  - Agent replies to `ping` with `{type:"pong"}` → **but hub ignores it**

- Heartbeat thread → **⚠️ Partial**

  - Agent sends heartbeat every 10s
  - Hub listens, but heartbeats do not mark agent ONLINE automatically

---

# 2) **HUB**

## 2.1 **Key Store**

- In-memory key store → **✅ Working**
- Load from env → **⚠️ Working but not validated**
- Durable Postgres key store → **❌ Missing**

---

## 2.2 **Signature Verification**

Your implementation:

- canonical format = `method|path|bodyHash|requestId|ts`
- bodyHash based on incoming base64-decoded string → **⚠️ Wrong**
- expected HMAC built correctly
- timingSafeEqual used twice → **🔥 BUG**
- overwritten hash variables → **🔥 BUG**
- signature test failing → **🔥 Confirmed broken**

→ This whole function must be rewritten.

---

## 2.3 **Frontend Request Handling**

Hub requires:

```
meta = { frontendKey, signature, ts }
```

But SDK sends:

```
meta = { frontendKey, ts, signature: { sig, ts, canonical } }
```

→ **🔥 Broken mismatch between SDK and Hub**

Hub expects: `signature = string`
SDK sends: `signature = { sig: string, canonical: string }`

---

## 2.4 **Agent Routing**

- Route to agent → **✅ Implemented**
- Pending request map → **⚠️ Partial** (no cleanup on WS close)
- Timeout per request → **✅ Works**
- Multiple agents not load balanced → **❌ Missing**

---

## 2.5 **Rate Limiting**

- Redis initialized → **⚠️ Working**
- allowRequest() function exists → **⚠️ Partial**
- Not used anywhere → **❌ Missing usage**
- Token bucket implementation incomplete → **⚠️ Approximated**

---

## 2.6 **WebSocket Protocol**

- agent register → **🟡 Partially correct but supports two formats**
  (register + register_agent)
- frontend register → **🔥 Broken**

  - SDK sends `"frontend_register"`
  - Hub expects `"register_frontend"` or `"register_front"`

---

# 3) **SDK (HubClient)**

### 3.1 **Connection**

- WebSocket auto reconnect → **⚠️ Partial**

  - Works but retry logic is messy
  - No backoff

### 3.2 **Signing**

- buildSignature implemented → **⚠️ Partial**

  - body hashing is correct
  - HMAC correct
  - But client does NOT encode body to Base64 → mismatches hub expectations

### 3.3 **WebSocket protocol**

- Client sends `"frontend_register"` → **🔥 Hub does not accept this**
- Client sends signature embedded in:

```ts
meta = { signature: { sig, canonical }, ts, frontendKey };
```

Hub expects:

```ts
meta.signature === string;
```

---

# 4) **E2E Tests**

### Current tests:

- Signature success test → **🔥 Failing**
- Queue replay test → **⚠️ Working but mocks forward()**
- Rate limit test → **❌ Missing**
- Full stack E2E (hub+agent+backend) → **❌ Missing**

---

# 5) **System-Wide Issues / Duplicates / Broken Items**

### ❌ Duplicates

- 4 versions of `replayQueue()`
- 2 websocket register protocols for frontend
- 2 heartbeat systems
- 2 signature check strategies (hash vs base64 decode)

### ❌ Mismatches

- SDK signature ≠ Hub signature
- SDK register event ≠ Hub accepted event
- SDK payload structure ≠ Hub expected structure
- Hub canonical body hash ≠ SDK body hash logic

### ❌ Broken

- verifySignature double timingSafeEqual
- verifySignature receives non-string signature
- Hub decodes body incorrectly for hashing
- agent heartbeat ignored
- frontend never properly registered

---

# 🎯 **FINAL CLEANED STATUS TABLE**

### **Core Stability**

| Feature                         | Status |
| ------------------------------- | ------ |
| Retry/backoff                   | ✅     |
| Queue                           | ⚠️     |
| Reconnect                       | ✅     |
| Batching                        | ❌     |
| Durable offline buffer (sqlite) | ❌     |

### **Security**

| Feature          | Status                |
| ---------------- | --------------------- |
| Signature verify | 🔥 broken             |
| SDK signature    | ⚠️ mismatching        |
| Key store        | ⚠️ env only           |
| DB-backed keys   | ❌                    |
| Time window      | ⚠️ incorrect/untested |

### **Routing**

| Feature         | Status                       |
| --------------- | ---------------------------- |
| WS routing      | ⚠️                           |
| Pending map     | ⚠️ memory leak risk          |
| Agent selection | ❌ basic / no load balancing |

### **Rate Limiting**

| Feature                 | Status     |
| ----------------------- | ---------- |
| Redis init              | ⚠️         |
| Token bucket            | ⚠️         |
| Integrated into request | ❌ missing |

### **SDK**

| Feature           | Status    |
| ----------------- | --------- |
| Connect           | ⚠️        |
| Signing           | ⚠️        |
| Protocol matching | 🔥 broken |
| Browser bundle    | ❌        |

### **Tests**

| Feature         | Status     |
| --------------- | ---------- |
| Unit tests      | ⚠️         |
| Signature tests | 🔥 failing |
| Queue tests     | ⚠️ partial |
| Full E2E        | ❌ missing |

---

# 🚀 **NEXT ABSOLUTE PRIORITY (Critical fixes)**

Your system cannot function end-to-end until these 5 blockers are fixed:

### **1) Fix signature verification & unify signing format**

(Your #1 blocker)

### **2) Fix register_frontend protocol mismatch**

SDK must send what hub accepts.

### **3) Fix hub body hashing logic (Base64 vs raw)**

Guarantee canonical format is identical on both ends.

### **4) Fix meta.signature shape**

Hub expects string but gets object.

### **5) Deduplicate & fix queue replay**

---

# If you want:

I can now generate the following for you:

✅ **A corrected and hardened verifySignature() implementation**
✅ **The matching SDK buildSignature() implementation**
✅ **Correct WebSocket message schemas for agent + frontend**
✅ **A cleaned-up unified replayQueue()**
✅ **A working full-stack E2E test (Vitest) that runs hub+agent+backend**
✅ **A refactor plan to stabilize the whole platform**

Just tell me:

👉 **“Fix the signature system first”**
or
👉 **“Fix the WebSocket protocol first”**
or
👉 **“Give me the full refactor plan”**

Below is the **full refactor plan** for the entire system — **complete, sequenced, minimal breakage, maximum stability**, and ensuring **SDK ↔ Hub ↔ Agent** behave predictably.

This plan creates a clean, hardened, production-quality architecture.

---

# 🎯 **FULL SYSTEM REFACTOR PLAN (3 Phases, 18 Tasks)**

Designed to fix all current issues, remove duplicates, unify data formats, and provide a foundation for rate limiting, dashboards, and multi-tenant features.

---

# PHASE 1 — **Protocol, Signing & Core Reliability (Critical)**

These 8 tasks fix all blockers that prevent the system from working end-to-end.

---

## **1. Normalize WebSocket Protocol (SDK ↔ Hub ↔ Agent)**

### **Unify all message types to:**

### **Frontend Registration**

```json
{ "type": "frontend_register", "frontendKey": "front-demo" }
```

### **Agent Registration**

```json
{ "type": "agent_register", "agentId": "agent-123" }
```

### **Frontend → Hub Request**

```json
{
  "type": "frontend_request",
  "requestId": "uuid",
  "method": "GET",
  "path": "/hello",
  "bodyBase64": null,
  "meta": {
    "frontendKey": "front-demo",
    "ts": 123456,
    "signature": "hexstring"
  }
}
```

### **Hub → Agent Request Forward**

```json
{
  "type": "agent_invoke",
  "requestId": "uuid",
  "method": "GET",
  "path": "/hello",
  "bodyBase64": null
}
```

### **Agent → Hub Response**

```json
{
  "type": "agent_response",
  "requestId": "uuid",
  "status": 200,
  "bodyBase64": "..."
}
```

---

## **2. Unify Signature Format**

### **Canonical format:**

```
METHOD|PATH|BODY_BASE64||REQUEST_ID|TS
```

### **SDK MUST build exactly this**

### **Hub MUST verify exactly this**

Remove all variants, remove nested signature objects, unify to:

```ts
meta.signature: string
```

---

## **3. Rewrite `verifySignature()` Completely**

Problems to fix:

- double timingSafeEqual()
- wrong body hashing
- mismatched canonical format
- signature object instead of string

**Deliverables:**

- determine canonical exactly once
- decode body only during forwarding, never during hashing
- throw typed errors for:

  - missingKey
  - expired
  - invalidSignature

**Tests to add:**

- OK signature
- tampered path
- tampered body
- expired (ts drift > N seconds)
- missing key
- unknown key

---

## **4. Update SDK `buildSignature()`**

Match new canonical format.
Add:

- timestamp drift limit (client-side)
- ensure body is always converted to Base64

---

## **5. Fix Agent heartbeat & Hub agent TTL logic**

### Agent:

- send `"heartbeat"` every 10s

### Hub:

- maintain `agents[agentId] = { lastSeen, ws }`
- remove offline agents after 30s
- remove pending requests for dropped agents

---

## **6. Deduplicate `replayQueue()` + file queue**

You currently have 3–4 copies.

Produce a single library:

```
apps/agent/src/queue.ts
  - write
  - read
  - clear
  - replay
```

Requirements:

- atomic write (append-only)
- dedupe on crash
- include retries

---

## **7. Fix Hub request routing**

- pick 1 agent per project
- if no agent: respond with "no agent connected"
- enforce per-request timeout
- automatically cleanup pending requests on disconnect

---

## **8. Add Logging**

- minimal internal debug logging
- chalk-based colored logs
- log inbound/outbound WS messages (in debug mode)

---

# PHASE 2 — **Security Hardening & Reliability (High Impact)**

---

## **9. Rate Limiting (Redis Token Bucket)**

Complete and integrate:

- per-frontendKey
- tokens regenerated every second
- store:

  - `tokens`
  - `lastRefill`

- return:

  - allowed / denied
  - remaining tokens (optional)

Integrate in `handleFrontendRequest()` BEFORE signature verification.

---

## **10. Postgres-backed Key Storage**

Create:

### `keys` table:

```
id
frontendKey
secret
projectId
createdAt
revokedAt
```

Add REST endpoints:

- POST /keys → create
- POST /keys/rotate
- POST /keys/revoke
- GET /keys

SDK: provide CLI for:

```
hub keys create
hub keys rotate
hub keys revoke
```

Hub must check database before checking in-memory store.

---

## **11. Smarter Agent Selection**

Implement _simple_, deterministic load balancing:

- round-robin
- least-loaded (based on pending count)

---

## **12. Agent Offline Storage Upgrade (optional now, required later)**

Switch File Queue → SQLite queue:

- atomic writes
- no corruption
- fast replay

---

# PHASE 3 — **DX, Dashboard & Full E2E Reliability**

---

## **13. SDK Build System Upgrade**

Make SDK browser-friendly:

- output ESM + CJS
- produce `.d.ts` types
- tree-shakeable
- remove Node.js-only APIs (crypto → subtle crypto polyfill)

---

## **14. Dashboard (Next.js + Tailwind)**

Pages:

### `/projects`

- list projects
- create new project

### `/projects/:id/agents`

- show online/offline agents
- heartbeat timestamp
- message logs (stream)

### `/projects/:id/keys`

- list keys
- rotate/revoke UI
- create new key

---

## **15. CLI Tool**

Commands:

```
hub dev         # start hub + agent + backend
hub key create  # talk to hub API
hub key rotate
hub key revoke
hub agent start
```

---

## **16. Full E2E Vitest Test Suite**

Auto-start:

- hub
- agent
- backend (express server)

Tests:

### 1. Signature → VALID

### 2. Signature → INVALID (tampered)

### 3. Signature → EXPIRED

### 4. Request → agent → backend → back (200)

### 5. Queue replay on agent restart

### 6. Rate limit deny

### 7. Agent disconnect mid-request

---

## **17. Move Code Into Monorepo Packages**

### `/packages/sdk`

### `/packages/protocol`

(shared types, canonical builder)

### `/apps/hub`

### `/apps/agent`

Use shared types from `/packages/protocol`.

---

## **18. TypeScript Strict Mode Everywhere**

- no `any`
- full typing for all messages
- strong WebSocket type definitions
- generated types for JSON structures

---

# 🎯 Final Summary — Your System After This Refactor

When this refactor is complete, your platform will have:

### ✔ Solid WS protocol

### ✔ Correct signature system

### ✔ Fully deterministic routing

### ✔ Safe durable queue

### ✔ Integrated rate limiting

### ✔ Secure project/key isolation

### ✔ Browser-friendly SDK

### ✔ Full dashboard

### ✔ Full E2E test coverage

### ✔ Production-quality stability

---

# Want me to generate the task list for GitHub Issues / Linear / Jira?

I can output:

- bullets
- checkboxes
- numbered tasks
- epics + labels
- or a Markdown `ROADMAP.md`

Just tell me **your preferred format**.
