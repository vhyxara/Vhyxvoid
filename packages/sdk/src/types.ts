// ── Types ─────────────────────────────────────────────────────────────────────

export interface TunnelClientConfig {
  /** Hub WebSocket URL: wss://hub.yourplatform.com/sdk */
  hubUrl: string;
  /** API key ID (public) */
  keyId: string;
  /** Raw secret returned at key creation */
  secret: string;
  /** Target tunnel label (optional — defaults to first connected agent) */
  label?: string;
  /** Per-request timeout in ms (default: 30000) */
  timeout?: number;
  /** Enable local agent discovery for sub-1ms local-to-local calls (default: true) */
  localDiscovery?: boolean;
}

export interface TunnelResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  durationMs: number;
  /** true = response came from local agent (bypassed hub) */
  isLocal: boolean;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  query?: string;
  timeout?: number;
}

export class TunnelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TunnelError";
  }
}

export class TunnelTimeoutError extends TunnelError {
  constructor(requestId: string) {
    super("AGENT_TIMEOUT", `Request ${requestId} timed out`, true);
    this.name = "TunnelTimeoutError";
  }
}

// ── Pending call ───────────────────────────────────────────────────────────────

export interface PendingCall {
  resolve: (res: TunnelResponse) => void;
  reject: (err: TunnelError) => void;
  timer: ReturnType<typeof setTimeout>;
}
