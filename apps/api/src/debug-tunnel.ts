// DEBUG SCRIPT — run with: npx ts-node debug-tunnel.ts
// Place this file at the root of your project (same level as package.json)
// It checks the exact DB state and traces why session lookup fails

import { PrismaClient } from "@/generated/prisma";

const prisma = new PrismaClient({ log: ["query", "error"] });

async function debug() {
  console.log("\n=== TUNNEL DEBUG ===\n");

  // 1. Check all tunnel sessions in DB
  const sessions = await prisma.tunnelSession.findMany({
    orderBy: { connectedAt: "desc" },
    take: 10,
  });
  console.log(`TunnelSession rows in DB: ${sessions.length}`);
  if (sessions.length === 0) {
    console.log("❌ NO SESSIONS IN DB — upsert is failing silently");
    console.log("   Check hub logs for errors after agent connects");
  } else {
    console.log("Sessions:");
    sessions.forEach((s) => {
      console.log(`  agentId: ${s.agentId}`);
      console.log(`  accountId: ${s.accountId}`);
      console.log(`  apiKeyId: ${s.apiKeyId}`);
      console.log(`  label: ${s.label}`);
      console.log(`  status: ${s.status}`);
      console.log(`  connectedAt: ${s.connectedAt}`);
      console.log("  ---");
    });
  }

  // 2. Check all tunnel requests in DB
  const requests = await prisma.tunnelRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(`\nTunnelRequest rows in DB: ${requests.length}`);
  if (requests.length === 0) {
    console.log("❌ NO REQUESTS IN DB — create() is failing silently");
  } else {
    console.log("Requests:");
    requests.forEach((r) => {
      console.log(`  requestId: ${r.requestId}`);
      console.log(`  sessionId: ${r.sessionId}`);
      console.log(`  method: ${r.method} ${r.path}`);
      console.log(`  status: ${r.status}`);
      console.log("  ---");
    });
  }

  // 3. Check ApiKey table — verify internal UUID exists
  const apiKeys = await prisma.apiKey.findMany({
    select: { id: true, keyId: true, accountId: true, name: true },
    take: 5,
  });
  console.log("\nApiKey rows:");
  apiKeys.forEach((k) => {
    console.log(`  id (internal UUID): ${k.id}`);
    console.log(`  keyId (public):     ${k.keyId}`);
    console.log(`  accountId:          ${k.accountId}`);
    console.log(`  name:               ${k.name}`);
    console.log("  ---");
  });

  // 4. Try exact lookup the route does
  const testAgentId = sessions[0]?.agentId;
  if (testAgentId) {
    console.log(`\nTesting findByAgentId('${testAgentId}'):`);
    const found = await prisma.tunnelSession.findUnique({
      where: { agentId: testAgentId },
      select: { id: true, accountId: true, label: true, status: true },
    });
    console.log("Result:", found);
    if (!found) {
      console.log(
        "❌ findUnique returned null even though row exists — check agentId field",
      );
    } else {
      console.log("✅ findByAgentId works correctly");
    }
  }

  await prisma.$disconnect();
}

debug().catch((e) => {
  console.error("Debug error:", e);
  process.exit(1);
});
