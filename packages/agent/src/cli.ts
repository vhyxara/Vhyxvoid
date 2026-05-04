#!/usr/bin/env node
// packages/agent/src/cli.ts
// CLI entry point: npx @vhyxvoid/agent

import { Command } from "commander";
import { AgentClient } from "./AgentClient";
import crypto from "crypto";

import { version } from "../package.json";

const program = new Command();

program
  .name("vhyxvoid")
  .description(
    "Platform tunnel agent.\n" +
      "Connects your local server to the platform so the frontend SDK can reach it.",
  )
  .version(version)
  .option(
    "-k, --key <keyId>",
    "API key ID (e.g. vhyxvoid_dev_abc123). Env: VHYXVOID_API_KEY",
    process.env.VHYXVOID_API_KEY,
  )
  .option(
    "-s, --secret <secret>",
    "API key secret (shown once at creation). Env: VHYXVOID_SECRET",
    process.env.VHYXVOID_SECRET,
  )
  .option(
    "-p, --port <port>",
    "Local backend port to tunnel (e.g. 3000). Env: VHYXVOID_PORT",
    process.env.VHYXVOID_PORT ?? "3000",
  )
  .option(
    "-l, --label <label>",
    "Tunnel label — identifies this agent if you run multiple. Env: VHYXVOID_LABEL",
    process.env.VHYXVOID_LABEL ?? "default",
  )
  .option(
    "--hub <url>",
    "Hub WebSocket URL. Env: VHYXVOID_HUB_URL",
    process.env.VHYXVOID_HUB_URL ?? "wss://hub.yourplatform.com/agent",
  )
  .option(
    "--pepper <pepper>",
    "Server HMAC pepper (from platform settings). Env: SERVER_HMAC_PEPPER",
    process.env.SERVER_HMAC_PEPPER ?? "",
  )
  .option(
    "--queue-path <path>",
    "SQLite queue file path. Default: ~/.vhyxvoid/queue.db",
    process.env.VHYXVOID_QUEUE_PATH,
  )
  .option("--no-local-discovery", "Disable local discovery server on port 4242")
  .parse(process.argv);

const opts = program.opts<{
  key?: string;
  secret?: string;
  port: string;
  label: string;
  hub: string;
  pepper: string;
  queuePath?: string;
  localDiscovery: boolean;
}>();

// ── Validate required options ─────────────────────────────────────────────────

if (!opts.key) {
  console.error(
    "❌  --key is required. Get your API key from the platform dashboard.",
  );
  console.error(
    "    Usage: vhyxvoid --key vhyxvoid_dev_xxx --secret xxx --port 3000",
  );
  process.exit(1);
}

if (!opts.secret) {
  console.error(
    "❌  --secret is required. It was shown once when you created the API key.",
  );
  console.error(
    "    If you lost it, rotate the key from the dashboard to get a new secret.",
  );
  process.exit(1);
}

// ── Hash the secret ───────────────────────────────────────────────────────────
// The agent hashes the raw secret on startup using the server pepper.
// After this point, the raw secret is never kept in memory.
// secretHash = HMAC-SHA256(rawSecret, pepper)
// This matches how the Hub and API key module hash secrets in the database.

const pepper = opts.pepper;
const secretHash = pepper
  ? crypto.createHmac("sha256", pepper).update(opts.secret).digest("hex")
  : crypto.createHmac("sha256", "dev-pepper").update(opts.secret).digest("hex");

if (!pepper) {
  console.warn(
    "⚠  --pepper not set. Using dev-pepper — this will not work in production.\n" +
      "   Set SERVER_HMAC_PEPPER to match the value in your hub environment.",
  );
}

// ── Start agent ───────────────────────────────────────────────────────────────

const port = parseInt(opts.port, 10);
if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`❌  Invalid port: "${opts.port}"`);
  process.exit(1);
}

console.log(`\nvhyxvoid-agent v${version}`);
console.log(`  Key:    ${opts.key}`);
console.log(`  Label:  ${opts.label}`);
console.log(`  Port:   ${port}`);
console.log(`  Hub:    ${opts.hub}`);
console.log(`  Queue:  ${opts.queuePath ?? "~/.vhyxvoid/queue.db"}`);
console.log(
  `  Local discovery: ${opts.localDiscovery ? "enabled" : "disabled"}`,
);
console.log("");

const agent = new AgentClient({
  hubUrl: opts.hub,
  keyId: opts.key,
  secretHash,
  label: opts.label,
  port,
  agentVersion: version,
  queuePath: opts.queuePath,
  localDiscovery: opts.localDiscovery,
  onStateChange: (state) => {
    if (state === "CONNECTED") {
      console.log(
        `✅  Tunnel active — label "${opts.label}" → localhost:${port}`,
      );
      console.log(
        `    SDK requests with label "${opts.label}" will reach your backend.\n`,
      );
    }
    if (state === "RECONNECTING") {
      console.log("⚠   Disconnected from hub — reconnecting automatically...");
    }
    if (state === "STOPPED") {
      console.log("🛑  Agent stopped.");
    }
  },
});

agent.start();

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM — shutting down gracefully...");
  agent.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\nReceived SIGINT — shutting down gracefully...");
  agent.stop();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  agent.stop();
  process.exit(1);
});
