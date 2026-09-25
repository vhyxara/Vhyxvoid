import * as fs from "fs";
import * as path from "path";
import * as childProcess from "child_process";
import { AgentClient } from "@vhyxvoid/agent";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WithVhyxvoidOptions {
  /** API key ID. Default: VHYXVOID_API_KEY env var */
  key?: string;
  /** API secret. Default: VHYXVOID_SECRET env var */
  secret?: string;
  /** Tunnel label. Default: VHYXVOID_LABEL env var or 'app' */
  label?: string;
  /**
   * Port override. Default: auto-detected from next dev command,
   * then VHYXVOID_PORT env var, then 3000.
   */
  port?: number;
  /** Hub WebSocket URL. Default: VHYXVOID_HUB_URL or wss://hub.vhyxvoid.com/agent */
  hub?: string;
  /**
   * Write tunnel URL to this file after connect.
   * Default: '.env.local' if VHYXVOID_WRITE_ENV is set.
   * Set to false to disable.
   */
  writeEnv?: string | false;
  /**
   * Env var name to write tunnel URL into.
   * Default: VHYXVOID_ENV_KEY or 'NEXT_PUBLIC_TUNNEL_URL'
   */
  envKey?: string;
  /**
   * Disable tunnel even in dev. Default: auto (disabled in production).
   * Useful for CI or when you want to opt out.
   */
  enabled?: boolean;
  /** Called once when tunnel is active */
  onConnect?: (tunnelUrl: string) => void;
}

// ── Singleton guard ───────────────────────────────────────────────────────────

let agent: AgentClient | null = null;
let started = false;

// ── Port detection ────────────────────────────────────────────────────────────

function detectPort(): number {
  // 1. Check npm_lifecycle_script (the command that started this process)
  //    e.g. "next dev --turbopack -p 3010"
  const script =
    process.env.npm_lifecycle_script ?? process.env.npm_command ?? "";

  const portFlag = script.match(/-p\s+(\d+)|--port\s+(\d+)/);
  if (portFlag) {
    const p = parseInt(portFlag[1] ?? portFlag[2], 10);
    if (p > 0) return p;
  }

  // 2. Check VHYXVOID_PORT
  const envPort = parseInt(process.env.VHYXVOID_PORT ?? "", 10);
  if (envPort > 0) return envPort;

  // 3. Check PORT (common in many frameworks)
  const port = parseInt(process.env.PORT ?? "", 10);
  if (port > 0) return port;

  // 4. Default Next.js port
  return 3000;
}

// ── Env file helpers ──────────────────────────────────────────────────────────

function loadEnvFiles(): void {
  // Load .env.vhyxvoid if it exists — agent credentials
  for (const f of [".env", ".env.local", ".env.vhyxvoid"]) {
    const filePath = path.resolve(process.cwd(), f);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      // Don't override already-set env vars
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function writeEnvVar(filePath: string, key: string, value: string): void {
  try {
    const absPath = path.resolve(process.cwd(), filePath);
    let content = fs.existsSync(absPath)
      ? fs.readFileSync(absPath, "utf8")
      : "";
    const regex = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${value}`;
    content = regex.test(content)
      ? content.replace(regex, line)
      : content.endsWith("\n")
        ? content + line + "\n"
        : content + "\n" + line + "\n";
    fs.writeFileSync(absPath, content, "utf8");
  } catch (err) {
    console.warn(
      `[vhyxvoid] could not write to ${filePath}:`,
      (err as Error).message,
    );
  }
}

// ── Core ──────────────────────────────────────────────────────────────────────

function startTunnel(
  opts: Required<Omit<WithVhyxvoidOptions, "onConnect" | "writeEnv" | "enabled">> & {
    writeEnv: string | false;
    onConnect?: (url: string) => void;
  },
): void {
  if (started) return;
  started = true;

  if (!opts.key || !opts.secret) {
    console.warn(
      "\n[vhyxvoid] ⚠  Tunnel not started — missing credentials.\n" +
        "  Run: npx vhyxvoid init\n" +
        "  Or set VHYXVOID_API_KEY and VHYXVOID_SECRET in .env.vhyxvoid\n",
    );
    return;
  }

  agent = new AgentClient({
    hubUrl: opts.hub,
    keyId: opts.key,
    secret: opts.secret,
    label: opts.label,
    port: opts.port,
    disableQueue: true, // in-process agent reconnects automatically; no SQLite needed
    localDiscovery: false,
    onStateChange: (state) => {
      if (state === "RECONNECTING") {
        console.log("\n[vhyxvoid] ⚠  Disconnected — reconnecting...\n");
      }
    },
    onTunnelUrl: (tunnelUrl: string) => {
      console.log("\n  ┌─────────────────────────────────────────────┐");
      console.log(`  │  🚇 vhyxvoid tunnel active                   │`);
      console.log(`  │                                               │`);
      console.log(
        `  │  Local:   http://localhost:${opts.port}${" ".repeat(Math.max(0, 17 - String(opts.port).length))}│`,
      );
      console.log(
        `  │  Public:  ${tunnelUrl}${" ".repeat(Math.max(0, 37 - tunnelUrl.length))}│`,
      );
      console.log("  └─────────────────────────────────────────────┘\n");

      // Write to env file
      if (opts.writeEnv) {
        writeEnvVar(opts.writeEnv, opts.envKey, tunnelUrl);
        console.log(`  [vhyxvoid] Written ${opts.envKey} → ${opts.writeEnv}\n`);
      }

      opts.onConnect?.(tunnelUrl);
    },
  });

  agent.start();

  const cleanup = () => {
    agent?.stop();
    agent = null;
    started = false;
  };

  process.once("SIGTERM", () => cleanupThenReraise(cleanup, "SIGTERM"));
  process.once("SIGINT", () => cleanupThenReraise(cleanup, "SIGINT"));
  process.once("exit", cleanup);
}

/**
 * Listening for a signal replaces Node's default "exit on SIGINT/SIGTERM".
 * After cleaning up, re-raise it when nobody else handles it, so the first
 * Ctrl+C still exits (audit part2 G6). `next dev` has its own handlers, so
 * there this is only cleanup.
 */
function cleanupThenReraise(cleanup: () => void, signal: NodeJS.Signals): void {
  cleanup();
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

/** CI providers set CI (GitHub Actions, GitLab, CircleCI, Travis, ...). */
function isCI(): boolean {
  const ci = process.env.CI;
  return ci !== undefined && ci !== "" && ci !== "false" && ci !== "0";
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Wraps your Next.js config and starts the vhyxvoid tunnel
 * automatically when `next dev` runs.
 *
 * @example
 * // next.config.ts
 * import { withVhyxvoid } from '@vhyxvoid/next'
 *
 * const nextConfig = { ... }
 * export default withVhyxvoid(nextConfig)
 *
 * // With options:
 * export default withVhyxvoid(nextConfig, {
 *   label: 'app',
 *   writeEnv: '.env.local',
 *   envKey: 'NEXT_PUBLIC_API_URL',
 * })
 *
 * // Compose with other plugins:
 * export default withVhyxvoid(
 *   withNextIntl(nextConfig),
 *   { label: 'app' }
 * )
 */
export function withVhyxvoid(
  nextConfig: Record<string, unknown> = {},
  options: WithVhyxvoidOptions = {},
): Record<string, unknown> {
  // Only run in dev, never in production build or next start, and not on CI
  // unless enabled: true (the same rule as @vhyxvoid/middleware).
  const isDev =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PHASE === "phase-development-server";
  const enabled = options.enabled ?? (isDev && !isCI());

  if (!enabled) return nextConfig;

  // next.config runs multiple times (once per worker) — guard with singleton
  if (started) return nextConfig;

  // Load .env files before reading credentials
  loadEnvFiles();

  const key = options.key ?? process.env.VHYXVOID_API_KEY ?? "";
  const secret = options.secret ?? process.env.VHYXVOID_SECRET ?? "";
  const label = options.label ?? process.env.VHYXVOID_LABEL ?? "app";
  const hub =
    options.hub ??
    process.env.VHYXVOID_HUB_URL ??
    "wss://hub.vhyxvoid.com/agent";
  const port = options.port ?? detectPort();
  const envKey =
    options.envKey ?? process.env.VHYXVOID_ENV_KEY ?? "NEXT_PUBLIC_TUNNEL_URL";
  const writeEnv =
    options.writeEnv !== undefined
      ? options.writeEnv
      : process.env.VHYXVOID_WRITE_ENV || false;

  startTunnel({
    key,
    secret,
    label,
    hub,
    port,
    envKey,
    writeEnv,
    onConnect: options.onConnect,
  });

  return nextConfig;
}

// Named re-export for people who prefer this style
export { withVhyxvoid as default };
