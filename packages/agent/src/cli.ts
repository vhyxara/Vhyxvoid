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
import { labelProblem, normalizeLabel } from "@vhyxvoid/protocol";
import { formatResults, realDeps, runDoctor, type DoctorDeps } from "./doctor";

// Load .env, .env.local, .env.vhyxvoid in order (last wins). quiet: dotenv 17
// otherwise prints an "injecting env ... tip" line for every file on start.
for (const f of [".env", ".env.local", ".env.vhyxvoid"]) {
  if (fs.existsSync(f)) loadEnv({ path: f, override: true, quiet: true });
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

// ── doctor command ────────────────────────────────────────────────────────────

program
  .command("doctor")
  .description("Check your setup: credentials, local server, hub, sign-in, custom domain")
  .option("-k, --key <keyId>", "API key ID. Env: VHYXVOID_API_KEY", process.env.VHYXVOID_API_KEY)
  .option("-s, --secret <secret>", "API key secret. Env: VHYXVOID_SECRET", process.env.VHYXVOID_SECRET)
  .option("-p, --port <port>", "Local port. Env: VHYXVOID_PORT", process.env.VHYXVOID_PORT ?? "3000")
  .option("-l, --label <label>", "Tunnel label. Env: VHYXVOID_LABEL", process.env.VHYXVOID_LABEL ?? "default")
  .option("--hub <url>", "Hub WebSocket URL. Env: VHYXVOID_HUB_URL", process.env.VHYXVOID_HUB_URL ?? "wss://hub.vhyxvoid.com/agent")
  .option("--connect", "Also sign in to the hub with a temporary tunnel (uses one agent slot for a few seconds)")
  .option("--domain <hostname>", "Check the DNS records of a custom domain")
  .option("--domain-target <hostname>", "The hostname domains should point at (read from the API when omitted)")
  .option("--json", "Print the results as JSON")
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`\n❌  Invalid port: "${opts.port}"\n`);
      process.exit(1);
    }
    if (!opts.json) console.log(`\nvhyxvoid doctor (agent v${AGENT_VERSION})`);
    const results = await runDoctor(
      {
        key: opts.key,
        secret: opts.secret,
        label: normalizeLabel(opts.label),
        port,
        hub: opts.hub,
        connect: !!opts.connect,
        domain: opts.domain,
        domainTarget: opts.domainTarget,
      },
      realDeps(signInOnce),
    );
    console.log(opts.json ? JSON.stringify({ version: AGENT_VERSION, results }, null, 2) : formatResults(results));
    process.exit(results.some((r) => r.status === "fail") ? 1 : 0);
  });

// ── mock command ──────────────────────────────────────────────────────────────

program
  .command("mock <file>")
  .description("Serve a mock API on this machine, offline (a VhyxVoid mock export, OpenAPI, Postman, Mockoon or HAR file, as JSON)")
  .option("-p, --port <port>", "Port to listen on", "4010")
  .option("--host <host>", "Address to listen on (0.0.0.0 to reach it from other devices)", "127.0.0.1")
  .option("--no-watch", "Don't reload when the file changes")
  .option("-q, --quiet", "Don't print a line per request")
  .action(async (file: string, opts) => {
    const port = parseInt(opts.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`\n❌  Invalid port: "${opts.port}"\n`);
      process.exit(1);
    }
    const { startMockServer } = await import("./mockServer");
    let started: Awaited<ReturnType<typeof startMockServer>>;
    try {
      started = await startMockServer({ file, port, host: opts.host, log: opts.quiet ? undefined : (line) => console.log(`  ${line}`) });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      console.error(`\n❌  ${e.code === "EADDRINUSE" ? `Port ${port} is already in use. Pick another with --port.` : e.message}\n`);
      process.exit(1);
    }
    const m = started.current();
    const routes = m.def.endpoints.filter((e) => e.enabled).length;
    const resources = (m.def.resources ?? []).filter((r) => r.enabled);
    console.log(`\n  🧪  Mock "${m.name}" (${m.format}) on http://${opts.host === "0.0.0.0" ? "localhost" : opts.host}:${port}`);
    console.log(`      ${routes} endpoint${routes === 1 ? "" : "s"}${resources.length ? `, resources: ${resources.map((r) => r.path).join(", ")}` : ""}`);
    for (const w of m.warnings.slice(0, 5)) console.log(`      ⚠ ${w}`);
    if (opts.watch) {
      let timer: NodeJS.Timeout | undefined;
      fs.watch(file, () => {
        clearTimeout(timer);
        // Editors write in several steps; reload once things settle.
        timer = setTimeout(() => {
          try {
            const r = started.reload();
            console.log(`  ↻  Reloaded ${file}: ${r.def.endpoints.length} endpoints`);
          } catch (err) {
            console.log(`  ⚠  Not reloaded (keeping the previous version): ${(err as Error).message}`);
          }
        }, 150);
      });
    }
    console.log("      Ctrl+C to stop.\n");
    const stop = () => started.server.close(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

// ── test command ──────────────────────────────────────────────────────────────

program
  .command("test [file]")
  .description("Run an API collection and its checks: a file (a VhyxVoid collection export, or a Postman collection / OpenAPI document as JSON) here, or --collection stored in the workspace on the platform; exits 1 when a check fails, for CI")
  .option("-c, --collection <name|id>", "Run a collection stored in the workspace, on the platform (needs an API key with tests:run)")
  .option("--api-key <keyId.secret>", "API key for --collection. Env: VHYXVOID_API_KEY (+ VHYXVOID_SECRET)")
  .option("--api-url <origin>", "API origin. Env: VHYXVOID_API_URL (default https://api.vhyxvoid.com)")
  .option("-e, --env <name|file>", "Environment: a name inside the file, or a JSON file (VhyxVoid, Postman environment, or {\"NAME\": \"value\"})")
  .option("--var <NAME=value>", "Set a variable (repeatable); VHYXVOID_VAR_<NAME> environment variables work too", (v: string, prev: string[]) => [...prev, v], [] as string[])
  .option("--folder <name>", "Run one folder (\"Parent/Child\" for a nested one)")
  .option("--bail", "Stop at the first failing request")
  .option("--timeout <ms>", "Per-request timeout", "30000")
  .option("--delay <ms>", "Wait between requests", "0")
  .option("-k, --insecure", "Accept self-signed TLS certificates")
  .option("-L, --follow-redirects", "Follow redirects (up to 5)")
  .option("--junit <file>", "Write a JUnit XML report (GitHub Actions, GitLab, Jenkins show it)")
  .option("--json <file>", "Write the full report as JSON")
  .option("-q, --quiet", "Only print failures and the summary")
  .action(async (file: string | undefined, opts) => {
    const { runApiTests, exitCodeOf, UsageError, formatResult, formatSummary } = await import("./apiTest");
    if (opts.collection) {
      const p = await import("./platform");
      const { reportToJUnit } = await import("@vhyxvoid/shared/apiclient");
      try {
        const client = new p.PlatformClient(p.credentials({ apiKey: opts.apiKey, apiUrl: opts.apiUrl }));
        const ignored = [opts.timeout !== "30000" && "timeout", opts.delay !== "0" && "delay", opts.insecure && "insecure", opts.followRedirects && "follow-redirects"].filter(Boolean);
        if (ignored.length) console.error(`  ! --${ignored.join(", --")} only apply to file runs; the platform's runner uses the collection's settings`);
        const { parseVars } = await import("./apiTest");
        const r = await p.runRemote<import("@vhyxvoid/shared/apiclient").RunReport>(client, opts.collection, { environment: opts.env, folder: opts.folder, bail: Boolean(opts.bail), vars: parseVars(opts.var) });
        if (!opts.quiet) console.log(`\n  ${r.collection.name} (on the platform)\n`);
        for (const res of r.report.results) if (!opts.quiet || res.outcome !== "passed") for (const l of formatResult(res)) console.log(`  ${l}`);
        console.log(`\n  ${formatSummary(r.report)}${r.rateLimited ? " (stopped by the plan's send rate)" : ""}\n  ${r.url}\n`);
        if (opts.junit) fs.writeFileSync(opts.junit, reportToJUnit(r.report));
        if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(r.report, null, 2));
        p.writeJobSummary(`### ${exitCodeOf(r.report) ? "❌" : "✅"} ${r.collection.name}\n\n${formatSummary(r.report)}\n\n[Open in VhyxVoid](${r.url})`);
        process.exit(exitCodeOf(r.report));
      } catch (err) {
        console.error(`\n❌  ${(err as Error).message}\n`);
        process.exit(err instanceof p.UsageError ? 2 : 1);
      }
    }
    if (!file) {
      console.error("\n❌  Give a collection file, or --collection <name|id> to run one stored in the workspace.\n");
      process.exit(2);
    }
    try {
      const report = await runApiTests({
        file,
        env: opts.env,
        vars: opts.var,
        folder: opts.folder,
        bail: Boolean(opts.bail),
        timeoutMs: Math.max(1000, parseInt(opts.timeout, 10) || 30_000),
        delayMs: Math.max(0, parseInt(opts.delay, 10) || 0),
        insecure: Boolean(opts.insecure),
        followRedirects: Boolean(opts.followRedirects),
        junit: opts.junit,
        json: opts.json,
        quiet: Boolean(opts.quiet),
      });
      if (report.total === 0) console.error("  The collection has no requests to run.\n");
      process.exit(exitCodeOf(report));
    } catch (err) {
      console.error(`\n❌  ${(err as Error).message}\n`);
      process.exit(err instanceof UsageError ? 2 : 1);
    }
  });

// ── platform API: specs and collections from CI ──────────────────────────────

const withApi = (cmd: Command) =>
  cmd.option("--api-key <keyId.secret>", "API key. Env: VHYXVOID_API_KEY (+ VHYXVOID_SECRET)").option("--api-url <origin>", "API origin. Env: VHYXVOID_API_URL (default https://api.vhyxvoid.com)");

async function platformAction(fn: (p: typeof import("./platform"), client: import("./platform").PlatformClient) => Promise<number>, opts: { apiKey?: string; apiUrl?: string }) {
  const p = await import("./platform");
  try {
    const client = new p.PlatformClient(p.credentials(opts));
    process.exit(await fn(p, client));
  } catch (err) {
    console.error(`\n❌  ${(err as Error).message}\n`);
    process.exit(err instanceof p.UsageError ? 2 : 1);
  }
}

withApi(program.command("whoami").description("Show the workspace and scopes of the API key")).action((opts) =>
  platformAction(async (_p, client) => {
    const me = await client.whoami();
    console.log(`\n  ${me.workspace ?? me.accountId}\n  key ${me.keyId}\n  scopes ${me.scopes.join(", ")}\n  ${me.dashboardUrl}\n`);
    return 0;
  }, opts),
);

const specCmd = program.command("spec").description("Check and push OpenAPI specs (API docs) from a repository");

withApi(
  specCmd
    .command("check <file>")
    .description("Check a spec file: its problems, and its changes against the latest published version. Exits 1 on errors or breaking changes (see --fail-on). Needs specs:read")
    .requiredOption("-s, --spec <slug|id>", "The API docs to compare with")
    .option("--fail-on <level>", "breaking (default) | warning | none (only errors fail)", "breaking")
    .option("--markdown <file>", "Write a Markdown summary (for a PR comment); in GitHub Actions it also goes to the job summary"),
).action((file: string, opts) =>
  platformAction(async (p, client) => {
    const failOn = (["breaking", "warning", "none"].includes(opts.failOn) ? opts.failOn : "breaking") as import("./platform").FailOn;
    const c = await p.checkSpec(client, file, opts.spec);
    console.log(`\n${p.formatCheck(c).map((l) => `  ${l}`).join("\n")}\n`);
    const me = await client.whoami().catch(() => null);
    const summary = p.checkMarkdown(c, failOn, me?.dashboardUrl);
    if (opts.markdown) fs.writeFileSync(opts.markdown, summary);
    p.writeJobSummary(summary);
    const fail = p.checkFails(c, failOn);
    console.log(fail ? `  ✗ ${fail}\n` : "  ✓ OK\n");
    return fail ? 1 : 0;
  }, opts),
);

withApi(
  specCmd
    .command("push <file>")
    .description("Save a spec file as the draft of the API docs; --publish publishes it (refused on errors, and on breaking changes without --allow-breaking). Needs specs:write")
    .requiredOption("-s, --spec <slug|id>", "The API docs to update")
    .option("--publish", "Publish a new version")
    .option("--notes <text>", "Release notes for the version")
    .option("--allow-breaking", "Publish even with breaking changes"),
).action((file: string, opts) =>
  platformAction(async (p, client) => {
    const r = await p.pushSpec(client, file, opts.spec, { publish: Boolean(opts.publish), notes: opts.notes, allowBreaking: Boolean(opts.allowBreaking) });
    const failed = opts.publish && !r.published && !r.message.startsWith("Nothing to publish");
    console.log(`\n${p.formatCheck(r.check).map((l) => `  ${l}`).join("\n")}\n\n  ${failed ? "✗" : "✓"} ${r.message}\n`);
    return failed ? 1 : 0;
  }, opts),
);

const collectionCmd = program.command("collection").description("Keep API client collections in a repository");

withApi(
  collectionCmd
    .command("push <file>")
    .description("Replace a stored collection's requests, folders and variables from a file (VhyxVoid export, Postman, OpenAPI, HAR). Needs tests:run")
    .requiredOption("-c, --collection <name|id>", "The collection to replace"),
).action((file: string, opts) =>
  platformAction(async (p, client) => {
    const r = await p.pushCollection(client, file, opts.collection);
    console.log(`\n  ✓ ${r.collection.name}: ${r.requests} request(s) in ${r.folders} folder(s)\n`);
    return 0;
  }, opts),
);

const aiCmd = program.command("ai").description("Draft a mock API or tests with AI assist (needs an API key with ai:use)");

function writeDraft(out: string | undefined, json: unknown): string {
  const text = `${JSON.stringify(json, null, 2)}\n`;
  if (!out || out === "-") {
    process.stdout.write(text);
    return "stdout";
  }
  if (fs.existsSync(out)) throw new Error(`${out} already exists; pick another --out or remove it`);
  fs.writeFileSync(out, text);
  return out;
}

withApi(
  aiCmd
    .command("mock [description...]")
    .description("Draft mock endpoints from a description or captured traffic; writes a mock file to serve with `vhyxvoid mock`")
    .option("--traffic <tunnel>", "Learn from requests the request inspector captured on this tunnel")
    .option("--name <name>", "Name in the file", "AI draft")
    .option("-o, --out <file>", "Where to write the mock file (- for stdout)", "mock.vhyxvoid.json"),
).action((words: string[], opts) =>
  platformAction(async (p, client) => {
    const r = await p.aiMock(client, { description: words.join(" "), traffic: opts.traffic, name: opts.name });
    const where = writeDraft(opts.out, r.file);
    const log = where === "stdout" ? console.error : console.log;
    log(`\n  ✓ ${r.file.endpoints.length} endpoint(s) → ${where}\n  ${r.summary}`);
    for (const w of r.warnings) log(`  ! ${w}`);
    log(`  ${p.usageLine(r.usage)}${where === "stdout" ? "" : `\n\n  Try it: npx vhyxvoid mock ${where}`}\n`);
    return 0;
  }, opts),
);

withApi(
  aiCmd
    .command("tests [description...]")
    .description("Draft a test collection from a description, API docs or captured traffic; writes a collection file to run with `vhyxvoid test`")
    .option("--spec <slug|id>", "Base the tests on these API docs")
    .option("--traffic <tunnel>", "Learn from requests the request inspector captured on this tunnel")
    .option("--base-url <url>", "The API's base URL ({{baseUrl}})")
    .option("-o, --out <file>", "Where to write the collection file (- for stdout)", "tests.vhyxvoid.json"),
).action((words: string[], opts) =>
  platformAction(async (p, client) => {
    const r = await p.aiTests(client, { description: words.join(" "), traffic: opts.traffic, spec: opts.spec, baseUrl: opts.baseUrl });
    const where = writeDraft(opts.out, r.file);
    const log = where === "stdout" ? console.error : console.log;
    log(`\n  ✓ ${r.file.collection.requests.length} request(s) → ${where}\n  ${r.summary}`);
    for (const w of r.warnings) log(`  ! ${w}`);
    log(`  ${p.usageLine(r.usage)}${where === "stdout" ? "" : `\n\n  Run it: npx vhyxvoid test ${where}`}\n`);
    return 0;
  }, opts),
);

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

    // Labels become part of the public hostname; check before connecting.
    opts.label = normalizeLabel(opts.label);
    const labelError = labelProblem(opts.label);
    if (labelError) {
      console.error(`\n❌  Invalid label "${opts.label}": ${labelError}\n`);
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

/** Registers a temporary tunnel, waits for the hub's answer, then disconnects. */
function signInOnce(o: Parameters<DoctorDeps["signIn"]>[0]): ReturnType<DoctorDeps["signIn"]> {
  return new Promise((resolve) => {
    let settled = false;
    const quiet = () => {};
    const agent: AgentClient = new AgentClient({
      hubUrl: o.hub,
      keyId: o.key,
      secret: o.secret,
      label: o.label,
      port: 1,
      localDiscovery: false,
      quiet: true,
      onStateChange: (state) => {
        if (state === "CONNECTED") finish({ ok: true });
      },
      logger: {
        info: quiet,
        warn: quiet,
        error: (obj: object) => {
          const e = obj as { code?: string; message?: string };
          if (e.code) finish({ ok: false, code: e.code, message: e.message ?? "" });
        },
      },
    });
    const timer = setTimeout(() => finish({ ok: false, code: "TIMEOUT", message: `no answer within ${o.timeoutMs} ms` }), o.timeoutMs);
    function finish(r: { ok: true } | { ok: false; code: string; message: string }) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        agent.stop();
      } catch {
        // already stopped
      }
      resolve(r);
    }
    agent.start();
  });
}

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
