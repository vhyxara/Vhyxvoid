// ── Types ─────────────────────────────────────────────────────────────────────

export interface TunnelClientConfig {
  /** Hub WebSocket URL, for example `wss://hub.vhyxvoid.com/sdk`. */
  hubUrl: string;
  /** API key ID (public) */
  keyId: string;
  /** Raw secret returned at key creation */
  secret: string;
  /** Target tunnel label (optional — defaults to first connected agent) */
  label?: string;
  /** Per-request timeout in milliseconds. */
  timeout?: number;
  // Kept on one line: the docs generator copies JSDoc text into a table cell.
  /** Look for an agent on the same machine (port 4242) and send requests to it directly instead of through the hub. Default: `true`. Set `false` to always go through the hub. */
  localDiscovery?: boolean;
}

export interface TunnelResponse {
  status: number;
  headers: Record<string, string>;
  /** A text response (JSON, HTML, plain text) is a `string`. A binary response (image, PDF, audio, `application/octet-stream`) is a `Buffer` with the original bytes. `null` when the response has no body. */
  body: string | Buffer | null;
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
