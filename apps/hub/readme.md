// ─────────────────────────────────────────────────────────────────────────────
// PRISMA SCHEMA ADDITIONS
// Add these two models to your existing schema.prisma
// ─────────────────────────────────────────────────────────────────────────────

/\*

enum TunnelSessionStatus {
CONNECTED
DISCONNECTED
EVICTED
}

// Tracks active and historical agent connections.
// Queried by dashboard: "which tunnels are online for my account"
model TunnelSession {
id String @id @default(uuid())
agentId String @unique // hub-assigned stable ID per connection
accountId String
apiKeyId String
label String // tunnel name
status TunnelSessionStatus @default(CONNECTED)
hubInstanceId String? // which hub process owns this session
metadata Json? // { agentVersion, ip }
connectedAt DateTime @default(now())
disconnectedAt DateTime?

account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)
apiKey ApiKey @relation(fields: [apiKeyId], references: [id])
requests TunnelRequest[]

@@index([accountId])
@@index([accountId, status]) // dashboard: active tunnels per account
@@index([apiKeyId])
@@index([connectedAt])
}

// Append-only audit trail of every proxied request.
// Used for: analytics, debugging, billing, per-request rate limiting.
model TunnelRequest {
id String @id @default(uuid())
accountId String
apiKeyId String
sessionId String
requestId String @unique // the requestId from the protocol (idempotency key)
method String
path String
status Int? // HTTP response status (null if agent never responded)
durationMs Int?
errorCode String?
createdAt DateTime @default(now())

account Account @relation(fields: [accountId], references: [id])
apiKey ApiKey @relation(fields: [apiKeyId], references: [id])
session TunnelSession @relation(fields: [sessionId], references: [id])

@@index([accountId])
@@index([sessionId])
@@index([requestId])
@@index([createdAt])
@@index([accountId, createdAt]) // time-series analytics query
}

\*/

// ─────────────────────────────────────────────────────────────────────────────
// PACKAGE.JSON FILES
// ─────────────────────────────────────────────────────────────────────────────

// Root workspace package.json:
const rootPackageJson = {
"name": "@platform/root",
"private": true,
"workspaces": [
"apps/*",
"packages/*"
],
"scripts": {
"build": "turbo run build",
"dev": "turbo run dev",
"hub:dev": "tsx apps/hub/src/main.ts",
"hub:start": "node apps/hub/dist/main.js",
"agent:dev": "tsx packages/agent/src/cli.ts"
},
"devDependencies": {
"turbo": "^1.13.0",
"typescript": "^5.4.0",
"tsx": "^4.7.0"
}
};

// packages/protocol/package.json:
const protocolPackageJson = {
"name": "@platform/protocol",
"version": "1.0.0",
"main": "dist/index.js",
"types": "dist/index.d.ts",
"scripts": {
"build": "tsc",
"dev": "tsc --watch"
},
"dependencies": {},
"devDependencies": {
"typescript": "^5.4.0"
}
};

// packages/agent/package.json:
const agentPackageJson = {
"name": "@platform/agent",
"version": "1.0.0",
"description": "Platform tunnel agent — connect your local server to the platform",
"bin": { "bksr-agent": "dist/cli.js" },
"main": "dist/AgentClient.js",
"types": "dist/AgentClient.d.ts",
"scripts": {
"build": "tsc",
"dev": "tsx src/cli.ts"
},
"dependencies": {
"@platform/protocol": "workspace:\*",
"better-sqlite3": "^9.4.0",
"axios": "^1.6.0",
"commander": "^12.0.0",
"ws": "^8.16.0"
},
"devDependencies": {
"@types/better-sqlite3": "^7.6.8",
"@types/ws": "^8.5.10",
"typescript": "^5.4.0",
"tsx": "^4.7.0"
}
};

// packages/sdk/package.json:
const sdkPackageJson = {
"name": "@platform/sdk",
"version": "1.0.0",
"main": "dist/index.js",
"types": "dist/index.d.ts",
"scripts": {
"build": "tsc",
"dev": "tsc --watch"
},
"dependencies": {
"@platform/protocol": "workspace:\*",
"isomorphic-ws": "^5.0.0"
},
"devDependencies": {
"@types/node": "^20.0.0",
"typescript": "^5.4.0"
}
};

// apps/hub/package.json:
const hubPackageJson = {
"name": "@platform/hub",
"version": "1.0.0",
"private": true,
"main": "dist/main.js",
"scripts": {
"build": "tsc",
"dev": "tsx src/main.ts",
"start": "node dist/main.js"
},
"dependencies": {
"@platform/protocol": "workspace:_",
"@platform/shared": "workspace:_",
"@prisma/client": "^5.0.0",
"@upstash/redis": "^1.31.0",
"uWebSockets.js": "github:uNetworking/uWebSockets.js#v20.42.0",
"uuid": "^9.0.0"
},
"devDependencies": {
"@types/uuid": "^9.0.0",
"typescript": "^5.4.0",
"tsx": "^4.7.0"
}
};

// ─────────────────────────────────────────────────────────────────────────────
// USAGE EXAMPLES
// ─────────────────────────────────────────────────────────────────────────────

/\*

// ── Install and run the agent ─────────────────────────────────────────────────

npx @platform/agent \
 --key bksr_dev_abc123456789 \
 --secret your_raw_secret_here \
 --port 3000 \
 --label "payment-service"

// Or with env vars:
BKSR_API_KEY=bksr_dev_abc \
BKSR_SECRET=your_secret \
BKSR_PORT=3000 \
BKSR_LABEL=payment-service \
npx @platform/agent

// ── Frontend SDK usage ────────────────────────────────────────────────────────

import { TunnelClient } from '@platform/sdk';

const tunnel = new TunnelClient({
hubUrl: 'wss://hub.yourplatform.com/sdk',
keyId: 'bksr_dev_abc123',
secret: 'your_raw_secret',
label: 'payment-service', // optional — targets specific agent
});

await tunnel.connect();

// Single request
const res = await tunnel.post('/api/payments', { amount: 100, currency: 'USD' });
console.log(res.status, res.body, res.isLocal); // isLocal=true if dev machine

// Parallel requests (pipelining — all in flight simultaneously)
const [user, account, keys] = await Promise.all([
tunnel.get('/api/users/me'),
tunnel.get('/api/accounts/current'),
tunnel.get('/api/api-keys'),
]);

// With custom timeout
const slow = await tunnel.post('/api/reports/generate', data, { timeout: 60_000 });

// Handle errors
try {
const res = await tunnel.get('/api/protected');
} catch (err) {
if (err instanceof TunnelError) {
console.log(err.code); // 'AGENT_NOT_FOUND', 'AGENT_TIMEOUT', etc.
console.log(err.retryable); // whether to retry
}
}

// Disconnect when done
tunnel.disconnect();

// ── Multiple agents (multi-service setup) ─────────────────────────────────────

// Terminal 1: Payment service on port 3001
npx @platform/agent --key bksr_dev_xxx --secret xxx --port 3001 --label payment

// Terminal 2: Auth service on port 3002
npx @platform/agent --key bksr_dev_xxx --secret xxx --port 3002 --label auth

// Frontend: route to specific services
const paymentRes = await tunnel.post('/charge', data, { label: 'payment' });
const authRes = await tunnel.post('/verify', token, { label: 'auth' });

// ── Measuring local vs hub latency ───────────────────────────────────────────

const res = await tunnel.get('/health');
if (res.isLocal) {
console.log(`Local path: ${res.durationMs}ms`); // typically < 2ms
} else {
console.log(`Hub path: ${res.durationMs}ms`); // typically 8-20ms same region
}

\*/
