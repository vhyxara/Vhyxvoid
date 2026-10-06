// apps/api -> apps/hub internal endpoints (live agents, stats, disconnect),
// authorized by the shared HUB_INTERNAL_SECRET. Never exposed publicly: nginx
// blocks /internal/ on hub., and the api reaches the hub over the Docker
// network (HUB_INTERNAL_URL=http://hub:9001).

export type HubAgent = {
  agentId: string;
  accountId: string;
  /** Row id (ApiKey.id) of the key the agent signed in with. */
  keyId?: string;
  /** Requests waiting for this agent's answer right now. */
  inFlight?: number;
  label: string;
  agentVersion?: string;
  ip?: string;
  connectedAt: string;
  lastSeenAt: string;
  missedPings: number;
  capabilities: string[];
};

export type HubStats = {
  instanceId: string;
  uptimeSeconds: number;
  agents: number;
  sdks: number;
  pendingRequests: number;
  tunnelWebSockets: number;
  pendingAuthSockets: number;
  memory: { heapUsedMb: number; rssMb: number };
  nodeVersion: string;
};

export class HubUnavailableError extends Error {}

export class HubClient {
  constructor(
    private readonly baseUrl = process.env.HUB_INTERNAL_URL ?? "",
    private readonly secret = process.env.HUB_INTERNAL_SECRET ?? "",
    private readonly timeoutMs = 3_000,
  ) {}

  get configured(): boolean {
    return Boolean(this.baseUrl && this.secret);
  }

  private async call<T>(path: string, method: "GET" | "POST" = "GET"): Promise<T> {
    if (!this.configured) throw new HubUnavailableError("HUB_INTERNAL_URL and HUB_INTERNAL_SECRET are not set");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: { "x-hub-internal-secret": this.secret },
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok && res.status !== 404) throw new HubUnavailableError(`hub answered ${res.status}: ${body.error ?? ""}`);
      return body;
    } catch (err) {
      if (err instanceof HubUnavailableError) throw err;
      throw new HubUnavailableError(`hub unreachable: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  stats(): Promise<HubStats> {
    return this.call<HubStats>("/internal/stats");
  }

  async agents(accountId?: string): Promise<HubAgent[]> {
    const q = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
    return (await this.call<{ agents: HubAgent[] }>(`/internal/agents${q}`)).agents ?? [];
  }

  async disconnect(agentId: string, reason?: string): Promise<boolean> {
    const q = reason ? `?${new URLSearchParams({ reason })}` : "";
    return (await this.call<{ disconnected: boolean }>(`/internal/agents/${encodeURIComponent(agentId)}/disconnect${q}`, "POST")).disconnected === true;
  }

  /**
   * Replay an inspected request through its tunnel. Returns the hub's answer
   * as-is (404 gone, 422 not replayable, 200 with the new response status).
   */
  async replay(accountId: string, label: string, id: string): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!this.configured) throw new HubUnavailableError("HUB_INTERNAL_URL and HUB_INTERNAL_SECRET are not set");
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/internal/replay`, {
        method: "POST",
        headers: { "x-hub-internal-secret": this.secret, "content-type": "application/json" },
        body: JSON.stringify({ accountId, label, id }),
        signal: AbortSignal.timeout(65_000),
      });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch (err) {
      throw new HubUnavailableError(`hub unreachable: ${(err as Error).message}`);
    }
  }

  /** Drop the hub's cached access rules so a change applies at once. Best effort. */
  async invalidatePolicy(accountId: string, label?: string): Promise<void> {
    if (!this.configured) return;
    const q = new URLSearchParams({ accountId, ...(label ? { label } : {}) });
    await this.call(`/internal/policies/invalidate?${q}`, "POST").catch(() => {});
  }

  /** Tell the hub an inbox changed (settings or redelivery); `drain` also delivers now. Best effort. */
  async inbox(action: "drain" | "invalidate", accountId: string, label: string): Promise<{ connected: boolean } | null> {
    if (!this.configured) return null;
    const q = new URLSearchParams({ accountId, label });
    return this.call<{ connected: boolean }>(`/internal/inbox/${action}?${q}`, "POST").catch(() => null);
  }

  /** Drop the hub's cached route for a custom domain. Best effort. */
  async invalidateDomain(hostname: string): Promise<void> {
    if (!this.configured) return;
    await this.call(`/internal/domains/invalidate?${new URLSearchParams({ hostname })}`, "POST").catch(() => {});
  }

  /** Disconnect every live agent of an account (suspension, deletion). Best effort. */
  async disconnectAccount(accountId: string): Promise<number> {
    if (!this.configured) return 0;
    try {
      const agents = await this.agents(accountId);
      const results = await Promise.allSettled(agents.map((a) => this.disconnect(a.agentId)));
      return results.filter((r) => r.status === "fulfilled" && r.value).length;
    } catch {
      return 0;
    }
  }
}
