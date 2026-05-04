// packages/agent/src/discovery/LocalDiscoveryServer.ts
// Broadcasts agent presence on localhost:4242.
// SDK discovers this and bypasses Hub for local-to-local calls (<1ms overhead).

import http from "http";
import { LIMITS } from "@vhyxvoid/protocol";

export interface DiscoveryPayload {
  /** npm package version */
  agentVersion: string;
  /** Tunnel label */
  label: string;
  /** Local backend port the agent is proxying to */
  port: number;
  /**
   * SHA-256 of accountId — lets SDK verify it's talking to an agent for the same account
   * without exposing the actual accountId over the local network.
   * Populated after hub:registered is received.
   */
  accountIdHash: string;
}

export class LocalDiscoveryServer {
  private server: http.Server | null = null;
  private payload: DiscoveryPayload;

  constructor(payload: DiscoveryPayload) {
    this.payload = payload;
  }

  /** Update the accountIdHash after hub registration completes */
  setAccountIdHash(hash: string): void {
    this.payload = { ...this.payload, accountIdHash: hash };
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      // Only respond to the discovery endpoint
      if (req.url !== "/vhyxvoid" || req.method !== "GET") {
        res.writeHead(404).end();
        return;
      }

      const body = JSON.stringify(this.payload);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body).toString(),
        "Cache-Control": "no-cache",
      });
      res.end(body);
    });

    this.server.listen(LIMITS.LOCAL_AGENT_DISCOVERY_PORT, "127.0.0.1", () => {
      console.info(
        `[discovery] local discovery server ready on port ${LIMITS.LOCAL_AGENT_DISCOVERY_PORT}`,
      );
    });

    this.server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Non-fatal — another agent instance may be running
        console.warn(
          `[discovery] port ${LIMITS.LOCAL_AGENT_DISCOVERY_PORT} in use — ` +
            `local discovery disabled. Another agent may already be running.`,
        );
      } else {
        console.warn(`[discovery] server error: ${err.message}`);
      }
      // Local discovery is an optimization, not required — never crash here
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }
}
