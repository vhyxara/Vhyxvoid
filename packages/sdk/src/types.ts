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
  /**
   * A text response (JSON, HTML, plain text, ...) is a string, as before.
   * A binary response (image, PDF, audio/video, octet-stream, ...) is a
   * real Buffer with the original bytes, not a base64 string or a
   * corrupted UTF-8 decode of them — see context.md risk #21. This is a
   * widened type (previously always `string | null`); no existing caller
   * in this repo assumed `body` was always a string for a binary response,
   * since that path never actually worked correctly before this fix.
   */
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
