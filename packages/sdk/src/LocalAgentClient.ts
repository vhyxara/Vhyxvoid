// ── Local Agent Client ────────────────────────────────────────────────────────
// Tries to call the agent's local discovery server directly.
// If successful: sub-1ms overhead instead of full hub round-trip.

import http from "http";
import { TunnelResponse } from "./types";
import { LIMITS, TIMING, isBinaryContentType } from "@vhyxvoid/protocol";

export interface LocalForwardParams {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string | null;
}

export class LocalAgentClient {
  private cachedAgent: { port: number; expiresAt: number } | null = null;

  async tryRequest(params: LocalForwardParams): Promise<TunnelResponse | null> {
    // Check for local agent
    const agentInfo = await this.discover();
    if (!agentInfo) return null;

    try {
      const start = Date.now();
      const body = await this.httpRequest(agentInfo.port, params);
      return {
        status: body.status,
        headers: body.headers,
        body: body.body,
        durationMs: Date.now() - start,
        isLocal: true,
      };
    } catch {
      // Local agent unavailable — fall back to hub
      this.cachedAgent = null;
      return null;
    }
  }

  private async discover(): Promise<{ port: number } | null> {
    // Cache discovery result for 5 seconds
    if (this.cachedAgent && Date.now() < this.cachedAgent.expiresAt) {
      return this.cachedAgent;
    }

    try {
      const result = (await Promise.race([
        fetch(`http://127.0.0.1:${LIMITS.LOCAL_AGENT_DISCOVERY_PORT}/vhyxvoid`),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(null), TIMING.LOCAL_DISCOVERY_TIMEOUT_MS),
        ),
      ])) as Response | null;

      if (!result?.ok) return null;

      const data = (await result.json()) as { port: number };
      this.cachedAgent = { port: data.port, expiresAt: Date.now() + 5_000 };
      return this.cachedAgent;
    } catch {
      return null;
    }
  }

  private httpRequest(
    port: number,
    params: LocalForwardParams,
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string | Buffer | null;
  }> {
    return new Promise((resolve, reject) => {
      const url = `${params.path}${params.query ? `?${params.query}` : ""}`;

      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: url,
          method: params.method,
          headers: params.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            // This connects directly to the developer's real local
            // backend, bypassing the hub/BackendProxy entirely — it never
            // sees a bodyEncoding field, so it must do its own
            // content-type-based binary detection to avoid the same
            // lossy toString('utf8') corruption fixed elsewhere for the
            // hub-routed paths (context.md risk #21).
            let body: string | Buffer | null = null;
            if (chunks.length) {
              const buf = Buffer.concat(chunks);
              body = isBinaryContentType(res.headers["content-type"])
                ? buf
                : buf.toString("utf8");
            }
            resolve({
              status: res.statusCode ?? 200,
              headers: res.headers as Record<string, string>,
              body,
            });
          });
          res.on("error", reject);
        },
      );

      req.on("error", reject);
      if (params.body) req.write(params.body);
      req.end();
    });
  }
}
