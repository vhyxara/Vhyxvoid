#!/usr/bin/env node
// // packages/agent/src/cli.ts
// // CLI entry point: npx @vhyxvoid/agent

// import { Command } from "commander";
// import { AgentClient } from "./AgentClient";
// // import crypto from "crypto";

// import { AGENT_VERSION } from "./version";
// import { config } from "dotenv";

// config();
// const program = new Command();

// program
//   .name("vhyxvoid")
//   .description(
//     "Platform tunnel agent.\n" +
//       "Connects your local server to the platform so the frontend SDK can reach it.",
//   )
//   .version(version)
//   .option(
//     "-k, --key <keyId>",
//     "API key ID (e.g. vhyxvoid_dev_abc123). Env: VHYXVOID_API_KEY",
//     process.env.VHYXVOID_API_KEY,
//   )
//   .option(
//     "-s, --secret <secret>",
//     "API key secret (shown once at creation). Env: VHYXVOID_SECRET",
//     process.env.VHYXVOID_SECRET,
//   )
//   .option(
//     "-p, --port <port>",
//     "Local backend port to tunnel (e.g. 3000). Env: VHYXVOID_PORT",
//     process.env.VHYXVOID_PORT ?? "3000",
//   )
//   .option(
//     "-l, --label <label>",
//     "Tunnel label — identifies this agent if you run multiple. Env: VHYXVOID_LABEL",
//     process.env.VHYXVOID_LABEL ?? "default",
//   )
//   .option(
//     "--hub <url>",
//     "Hub WebSocket URL. Env: VHYXVOID_HUB_URL",
//     process.env.VHYXVOID_HUB_URL ?? "wss://hub.vhyxvoid.com/agent",
//   )
//   // .option(
//   //   "--pepper <pepper>",
//   //   "Server HMAC pepper (from platform settings). Env: SERVER_HMAC_PEPPER",
//   //   process.env.SERVER_HMAC_PEPPER ?? "",
//   // )
//   .option(
//     "--queue-path <path>",
//     "SQLite queue file path. Default: ~/.vhyxvoid/queue.db",
//     process.env.VHYXVOID_QUEUE_PATH,
//   )
//   .option("--no-local-discovery", "Disable local discovery server on port 4242")
//   .parse(process.argv);

// const opts = program.opts<{
//   key?: string;
//   secret?: string;
//   port: string;
//   label: string;
//   hub: string;
//   // pepper: string;
//   queuePath?: string;
//   localDiscovery: boolean;
// }>();

// // ── Validate required options ─────────────────────────────────────────────────

// if (!opts.key) {
//   console.error(
//     "❌  --key is required. Get your API key from the platform dashboard.",
//   );
//   console.error(
//     "    Usage: vhyxvoid --key vhyxvoid_dev_xxx --secret xxx --port 3000",
//   );
//   process.exit(1);
// }

// if (!opts.secret) {
//   console.error(
//     "❌  --secret is required. It was shown once when you created the API key.",
//   );
//   console.error(
//     "    If you lost it, rotate the key from the dashboard to get a new secret.",
//   );
//   process.exit(1);
// }

// // ── Start agent ───────────────────────────────────────────────────────────────

// const port = parseInt(opts.port, 10);
// if (isNaN(port) || port < 1 || port > 65535) {
//   console.error(`❌  Invalid port: "${opts.port}"`);
//   process.exit(1);
// }

// console.log(`\nvhyxvoid-agent v${AGENT_VERSION}`);
// console.log(`  Key:    ${opts.key}`);
// console.log(`  Label:  ${opts.label}`);
// console.log(`  Port:   ${port}`);
// console.log(`  Hub:    ${opts.hub}`);
// console.log(`  Queue:  ${opts.queuePath ?? "~/.vhyxvoid/queue.db"}`);
// console.log(
//   `  Local discovery: ${opts.localDiscovery ? "enabled" : "disabled"}`,
// );
// console.log("");

// const agent = new AgentClient({
//   hubUrl: opts.hub,
//   keyId: opts.key,
//   secret: opts.secret,
//   label: opts.label,
//   port,
//   agentVersion: version,
//   queuePath: opts.queuePath,
//   localDiscovery: opts.localDiscovery,
//   onStateChange: (state) => {
//     if (state === "CONNECTED") {
//       console.log(
//         `✅  Tunnel active — label "${opts.label}" → localhost:${port}`,
//       );
//       console.log(
//         `    SDK requests with label "${opts.label}" will reach your backend.\n`,
//       );
//     }
//     if (state === "RECONNECTING") {
//       console.log("⚠   Disconnected from hub — reconnecting automatically...");
//     }
//     if (state === "STOPPED") {
//       console.log("🛑  Agent stopped.");
//     }
//   },
// });

// agent.start();

// // ── Graceful shutdown ─────────────────────────────────────────────────────────

// process.on("SIGTERM", () => {
//   console.log("\nReceived SIGTERM — shutting down gracefully...");
//   agent.stop();
//   process.exit(0);
// });

// process.on("SIGINT", () => {
//   console.log("\nReceived SIGINT — shutting down gracefully...");
//   agent.stop();
//   process.exit(0);
// });

// process.on("uncaughtException", (err) => {
//   console.error("Uncaught exception:", err);
//   agent.stop();
//   process.exit(1);
// });

import { Command } from "commander";
import { AgentClient } from "./AgentClient";
import { AGENT_VERSION } from "./version";
import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createPrompter } from "./prompt";

// Load .env, .env.local, .env.vhyxvoid in order (last wins)
for (const f of [".env", ".env.local", ".env.vhyxvoid"]) {
  if (fs.existsSync(f)) loadEnv({ path: f, override: true });
}

const program = new Command();

program
  .name("vhyxvoid")
  .description(
    "Platform tunnel agent — connects your local server to the platform.",
  )
  .version(AGENT_VERSION);

// ── init command ──────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Interactive setup — saves credentials to .env.vhyxvoid")
  .action(async () => {
    console.log("\n🚀  vhyxvoid setup\n");

    const prompter = createPrompter();
    const { ask, askSecret } = prompter;

    try {
      const key = await ask(
        "API key ID (e.g. vhyxvoid_dev_xxx)",
        process.env.VHYXVOID_API_KEY,
      );
      const secret = await askSecret("API key secret");
      const port = await ask(
        "Local backend port",
        process.env.VHYXVOID_PORT ?? "3000",
      );
      const label = await ask(
        "Tunnel label",
        process.env.VHYXVOID_LABEL ?? "default",
      );
      const hub = await ask(
        "Hub URL",
        process.env.VHYXVOID_HUB_URL ?? "wss://hub.vhyxvoid.com/agent",
      );
      const accountSlug = await ask(
        "Account slug (optional, the part of your tunnel URL before --)",
        process.env.VHYXVOID_ACCOUNT_SLUG,
      );

      prompter.close();

      if (!key || !secret) {
        console.error("\n❌  Key and secret are required.\n");
        process.exit(1);
      }

      const envContent = [
        `# vhyxvoid tunnel credentials — generated by "vhyxvoid init"`,
        `# DO NOT commit this file. It is already in .gitignore.`,
        ``,
        `VHYXVOID_API_KEY=${key}`,
        `VHYXVOID_SECRET=${secret}`,
        `VHYXVOID_PORT=${port}`,
        `VHYXVOID_LABEL=${label}`,
        `VHYXVOID_HUB_URL=${hub}`,
        accountSlug ? `VHYXVOID_ACCOUNT_SLUG=${accountSlug}` : null,
      ].join("\n");

      fs.writeFileSync(".env.vhyxvoid", envContent + "\n", "utf8");
      console.log("\n✅  Saved to .env.vhyxvoid");

      // Add to .gitignore if not already there
      const gitignorePath = ".gitignore";
      const gitignoreEntry = ".env.vhyxvoid";
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, "utf8");
        if (!content.includes(gitignoreEntry)) {
          fs.appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
          console.log("✅  Added .env.vhyxvoid to .gitignore");
        }
      } else {
        fs.writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
        console.log("✅  Created .gitignore with .env.vhyxvoid");
      }

      console.log("\n🎉  Setup complete! Run vhyxvoid to start the tunnel.\n");
    } catch (err) {
      prompter.close();
      console.error(`\n❌  Setup failed: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

// ── start command (default) ───────────────────────────────────────────────────

program
  .command("start", { isDefault: true })
  .description("Start the tunnel agent")
  .option(
    "-k, --key <keyId>",
    "API key ID. Env: VHYXVOID_API_KEY",
    process.env.VHYXVOID_API_KEY,
  )
  .option(
    "-s, --secret <secret>",
    "API key secret. Env: VHYXVOID_SECRET",
    process.env.VHYXVOID_SECRET,
  )
  .option(
    "-p, --port <port>",
    "Local port. Env: VHYXVOID_PORT",
    process.env.VHYXVOID_PORT ?? "3000",
  )
  .option(
    "-l, --label <label>",
    "Tunnel label. Env: VHYXVOID_LABEL",
    process.env.VHYXVOID_LABEL ?? "default",
  )
  .option(
    "--hub <url>",
    "Hub WebSocket URL. Env: VHYXVOID_HUB_URL",
    process.env.VHYXVOID_HUB_URL ?? "wss://hub.vhyxvoid.com/agent",
  )
  .option(
    "--queue-path <path>",
    "Deprecated and ignored (the agent no longer keeps a queue file).",
    process.env.VHYXVOID_QUEUE_PATH,
  )
  .option("--no-local-discovery", "Disable local discovery on port 4242")
  .option(
    "--debug",
    "Print verbose diagnostics. Env: VHYXVOID_DEBUG_LOGGING=true",
  )
  .option(
    "--write-env [file]",
    "Write tunnel URL to .env.local after connect. Env: VHYXVOID_WRITE_ENV",
    process.env.VHYXVOID_WRITE_ENV,
  )
  .option(
    "--env-key <key>",
    "Env var name to write tunnel URL into",
    process.env.VHYXVOID_ENV_KEY ?? "NEXT_PUBLIC_TUNNEL_URL",
  )
  .action((opts) => {
    if (opts.debug) process.env.VHYXVOID_DEBUG_LOGGING = "true";

    // Validate
    if (!opts.key) {
      console.error("\n❌  API key required.");
      console.error(
        "    Set VHYXVOID_API_KEY in .env.vhyxvoid or pass --key\n",
      );
      console.error("    Run: vhyxvoid init\n");
      process.exit(1);
    }
    if (!opts.secret) {
      console.error("\n❌  Secret required.");
      console.error(
        "    Set VHYXVOID_SECRET in .env.vhyxvoid or pass --secret\n",
      );
      console.error("    Run: vhyxvoid init\n");
      process.exit(1);
    }

    const port = parseInt(opts.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`\n❌  Invalid port: "${opts.port}"\n`);
      process.exit(1);
    }

    console.log(`\nvhyxvoid-agent v${AGENT_VERSION}`);
    console.log(`  Key:    ${opts.key}`);
    console.log(`  Label:  ${opts.label}`);
    console.log(`  Port:   ${port}`);
    console.log(`  Hub:    ${opts.hub}`);
    console.log(
      `  Local discovery: ${opts.localDiscovery ? "enabled" : "disabled"}`,
    );
    console.log("");

    removeLegacyQueueFile();

    let shuttingDown = false;
    const agent = new AgentClient({
      hubUrl: opts.hub,
      keyId: opts.key,
      secret: opts.secret,
      label: opts.label,
      port,
      localDiscovery: opts.localDiscovery,
      onStateChange: (state) => {
        if (state === "RECONNECTING") {
          console.log(
            "⚠   Disconnected from hub — reconnecting automatically...",
          );
        }
        if (state === "STOPPED") {
          console.log("🛑  Agent stopped.");
          // Not from Ctrl+C/SIGTERM: the hub refused the key (revoked,
          // expired, wrong secret, missing scope) or the agent version. Exit
          // non-zero so scripts and process managers see the failure.
          if (!shuttingDown) process.exit(1);
        }
      },
      onTunnelUrl: (tunnelUrl) => {
        // Auto-write tunnel URL to .env.local if --write-env flag set
        if (!opts.writeEnv) return;
        const envFile =
          typeof opts.writeEnv === "string" ? opts.writeEnv : ".env.local";
        const envKey = opts.envKey;
        writeEnvVar(envFile, envKey, tunnelUrl);
        console.log(`\n  📝  Written ${envKey}=${tunnelUrl} to ${envFile}\n`);
      },
    });

    agent.start();

    process.on("SIGTERM", () => {
      console.log("\nReceived SIGTERM — shutting down gracefully...");
      shuttingDown = true;
      agent.stop();
      process.exit(0);
    });

    process.on("SIGINT", () => {
      console.log("\nReceived SIGINT — shutting down gracefully...");
      shuttingDown = true;
      agent.stop();
      process.exit(0);
    });

    process.on("uncaughtException", (err) => {
      console.error("Uncaught exception:", err);
      // Don't crash — log and continue (agent reconnects)
    });
  });

program.parse(process.argv);

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeEnvVar(filePath: string, key: string, value: string): void {
  try {
    let content = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf8")
      : "";
    const regex = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${value}`;
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content.endsWith("\n")
        ? content + line + "\n"
        : content + "\n" + line + "\n";
    }
    fs.writeFileSync(filePath, content, "utf8");
  } catch (err) {
    console.warn(
      `[agent] could not write to ${filePath}:`,
      (err as Error).message,
    );
  }
}

/**
 * Agents up to 1.0.20 wrote undelivered responses (full bodies) to
 * ~/.vhyxvoid/queue.db. The queue is gone, so delete the file and its WAL
 * side files rather than leave that data on disk. Best effort.
 */
function removeLegacyQueueFile(): void {
  const base = path.join(os.homedir(), ".vhyxvoid", "queue.db");
  for (const f of [base, `${base}-wal`, `${base}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      // not ours to fail on
    }
  }
}
