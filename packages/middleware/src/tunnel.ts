import * as fs from "fs";
import * as path from "path";
import { AgentClient } from "@vhyxvoid/agent";

// Prevent multiple tunnel instances in the same process (e.g. Next.js hot reload)
let instance: AgentClient | null = null;

export interface TunnelOptions {
  key: string;
  secret: string;
  port: number;
  label: string;
  hub: string;
  writeEnv?: string;
  envKey: string;
  onConnect?: (tunnelUrl: string) => void;
}

export function startTunnel(opts: TunnelOptions): AgentClient {
  if (instance) {
    console.log("[vhyxvoid] tunnel already running, skipping");
    return instance;
  }

  if (!opts.key || !opts.secret) {
    console.warn(
      "[vhyxvoid] ⚠  Missing VHYXVOID_API_KEY or VHYXVOID_SECRET — tunnel not started.\n" +
        "           Run: vhyxvoid init",
    );
    // Return a no-op stub so callers don't crash
    return { stop: () => {}, start: () => {} } as any;
  }

  const agent = new AgentClient({
    hubUrl: opts.hub,
    keyId: opts.key,
    secret: opts.secret,
    label: opts.label,
    port: opts.port,
    disableQueue: true, // in-process agent reconnects automatically; no SQLite needed
    localDiscovery: false, // disable in middleware mode — no separate CLI discovery
    onStateChange: (state) => {
      if (state === "RECONNECTING") {
        console.log("[vhyxvoid] ⚠  Disconnected — reconnecting...");
      }
    },
    onTunnelUrl: (tunnelUrl) => {
      console.log(`\n  [vhyxvoid] ✅  Tunnel active`);
      console.log(`  [vhyxvoid] Public:  ${tunnelUrl}`);
      console.log(`  [vhyxvoid] Local:   http://localhost:${opts.port}\n`);

      if (opts.writeEnv) {
        writeEnvVar(opts.writeEnv, opts.envKey, tunnelUrl);
        console.log(
          `  [vhyxvoid] Written ${opts.envKey}=${tunnelUrl} → ${opts.writeEnv}`,
        );
      }

      opts.onConnect?.(tunnelUrl);
    },
  });

  agent.start();
  instance = agent;

  // Clean up on process exit
  const cleanup = () => {
    instance?.stop();
    instance = null;
  };
  process.once("SIGTERM", () => cleanupThenReraise(cleanup, "SIGTERM"));
  process.once("SIGINT", () => cleanupThenReraise(cleanup, "SIGINT"));
  process.once("exit", cleanup);

  return agent;
}

/**
 * Listening for a signal replaces Node's default "exit on SIGINT/SIGTERM",
 * so a plain Express app needed two Ctrl+C and `docker stop` waited for
 * SIGKILL (audit part2 G6). After cleaning up, re-raise the signal when no
 * other listener handles it; an app with its own graceful-shutdown handler
 * keeps full control.
 */
export function cleanupThenReraise(
  cleanup: () => void,
  signal: NodeJS.Signals,
): void {
  cleanup();
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

export function stopTunnel(): void {
  instance?.stop();
  instance = null;
}

function writeEnvVar(filePath: string, key: string, value: string): void {
  try {
    let content = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf8")
      : "";
    const regex = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${value}`;
    content = regex.test(content)
      ? content.replace(regex, line)
      : content.endsWith("\n")
        ? content + line + "\n"
        : content + "\n" + line + "\n";
    fs.writeFileSync(filePath, content, "utf8");
  } catch (err) {
    console.warn(
      `[vhyxvoid] could not write to ${filePath}:`,
      (err as Error).message,
    );
  }
}
