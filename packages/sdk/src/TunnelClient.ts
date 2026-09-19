// packages/sdk/src/TunnelClient.ts
// WebSocket client for Node.js. Manages a persistent WS connection to the hub.
// Node-only: it signs with Node's crypto module and cannot be bundled for a
// browser, and it is configured with the API key secret, which must never be
// shipped in client-side code. See internal-tools/shared/decision.md, 2026-09-19,
// "SDK reclassified as Node-only".
// Supports local agent discovery (bypasses hub for local-to-local calls).

import WebSocket, { MessageEvent } from "isomorphic-ws";
import { randomUUID, createHmac } from "crypto";
import {
  parseMessage,
  serialize,
  buildCanonical,
  signCanonical,
  SdkRegisterMsg,
  SdkRequestMsg,
  SdkRegisteredMsg,
  SdkResponseMsg,
  SdkErrorMsg,
  PROTOCOL_VERSION,
  TIMING,
  LIMITS,
} from "@vhyxvoid/protocol";
import {
  PendingCall,
  RequestOptions,
  TunnelClientConfig,
  TunnelError,
  TunnelResponse,
  TunnelTimeoutError,
} from "./types";
import { LocalAgentClient } from "./LocalAgentClient";

// ── TunnelClient ──────────────────────────────────────────────────────────────

export class TunnelClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private connected: boolean = false;
  private readonly pending = new Map<string, PendingCall>();
  private localAgent: LocalAgentClient | null = null;

  constructor(private readonly config: TunnelClientConfig) {
    if (config.localDiscovery !== false) {
      this.localAgent = new LocalAgentClient();
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.hubUrl);
      this.ws = ws;

      ws.onopen = () => {
        // Send sdk:register handshake
        const now = Date.now();
        const requestId = randomUUID();
        const canonical = buildCanonical({
          method: "SDK_REGISTER",
          path: "/sdk/register",
          query: "",
          body: "",
          requestId,
          ts: now,
        });
        const signature = signCanonical(canonical, this.config.secret);

        const msg: SdkRegisterMsg = {
          v: PROTOCOL_VERSION,
          type: "sdk:register",
          keyId: this.config.keyId,
          requestId,
          ts: now,
          signature,
        };
        ws.send(serialize(msg));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data =
            typeof event.data === "string"
              ? event.data
              : Buffer.from(event.data as ArrayBuffer);

          const msg = parseMessage(data);
          // const msg = parseMessage(
          //   typeof event.data === "string"
          //     ? event.data
          //     : Buffer.from(event.data),
          // );

          if (msg.type === "sdk:registered") {
            this.sessionId = (msg as SdkRegisteredMsg).sessionId;
            this.connected = true;
            resolve();
            return;
          }

          this.onMessage(msg as SdkResponseMsg | SdkErrorMsg);
        } catch (err) {
          // Only reject on connection-phase errors
          if (!this.connected) reject(err);
        }
      };

      ws.onerror = (err: any) => {
        if (!this.connected)
          reject(new Error(`Hub connection failed: ${err.message}`));
      };

      ws.onclose = () => {
        this.connected = false;
        // Reject all pending requests
        for (const [requestId, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(
            new TunnelError(
              "AGENT_DISCONNECTED",
              "Hub connection closed",
              true,
            ),
          );
        }
        this.pending.clear();
      };
    });
  }

  disconnect(): void {
    this.ws?.close(1000, "client_disconnect");
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
  }

  // ── Core request method ────────────────────────────────────────────────────

  async request(params: {
    method: string;
    path: string;
    query?: string;
    headers?: Record<string, string>;
    body?: unknown;
    label?: string;
    timeout?: number;
  }): Promise<TunnelResponse> {
    const bodyStr = params.body != null ? JSON.stringify(params.body) : null;

    // ── Local agent discovery — bypass hub entirely ───────────────────────────
    if (this.localAgent) {
      const local = await this.localAgent.tryRequest({
        method: params.method,
        path: params.path,
        query: params.query ?? "",
        headers: params.headers ?? {},
        body: bodyStr,
      });
      if (local) return local;
    }

    // ── Hub routing ───────────────────────────────────────────────────────────
    if (!this.connected || !this.ws) {
      throw new TunnelError(
        "AGENT_NOT_FOUND",
        "Not connected to hub. Call connect() first.",
        false,
      );
    }

    const requestId = randomUUID();
    const now = Date.now();
    const query = params.query ?? "";

    const canonical = buildCanonical({
      method: params.method,
      path: params.path,
      query,
      body: bodyStr ?? "",
      requestId,
      ts: now,
    });
    const signature = signCanonical(canonical, this.config.secret);

    const msg: SdkRequestMsg = {
      v: PROTOCOL_VERSION,
      type: "sdk:request",
      keyId: this.config.keyId,
      requestId,
      ts: now,
      signature,
      label: params.label ?? this.config.label,
      method: params.method,
      path: params.path,
      query,
      headers: params.headers ?? {},
      body: bodyStr,
    };

    return new Promise<TunnelResponse>((resolve, reject) => {
      const timeoutMs =
        params.timeout ?? this.config.timeout ?? TIMING.REQUEST_TIMEOUT_MS;

      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new TunnelTimeoutError(requestId));
      }, timeoutMs);

      this.pending.set(requestId, {
        resolve: (res) => resolve({ ...res, isLocal: false }),
        reject,
        timer,
      });

      this.ws!.send(serialize(msg));
    });
  }

  // ── Convenience methods ────────────────────────────────────────────────────

  get(path: string, opts: RequestOptions = {}): Promise<TunnelResponse> {
    return this.request({ method: "GET", path, ...opts });
  }

  post(
    path: string,
    body: unknown,
    opts: RequestOptions = {},
  ): Promise<TunnelResponse> {
    return this.request({ method: "POST", path, body, ...opts });
  }

  put(
    path: string,
    body: unknown,
    opts: RequestOptions = {},
  ): Promise<TunnelResponse> {
    return this.request({ method: "PUT", path, body, ...opts });
  }

  patch(
    path: string,
    body: unknown,
    opts: RequestOptions = {},
  ): Promise<TunnelResponse> {
    return this.request({ method: "PATCH", path, body, ...opts });
  }

  delete(path: string, opts: RequestOptions = {}): Promise<TunnelResponse> {
    return this.request({ method: "DELETE", path, ...opts });
  }

  // ── Message handler ────────────────────────────────────────────────────────

  private onMessage(msg: SdkResponseMsg | SdkErrorMsg): void {
    const requestId = msg.requestId;
    const pending = this.pending.get(requestId);
    if (!pending) return; // already timed out

    clearTimeout(pending.timer);
    this.pending.delete(requestId);

    if (msg.type === "sdk:response") {
      // msg.body is base64 text over the wire when bodyEncoding is
      // 'base64' (set by BackendProxy, passed through by the hub
      // unchanged — see context.md risk #21). Decode it back to real
      // bytes here; this is the SDK-side consumption this repo's
      // 2026-09-12 audit explicitly left unfixed. A plain text body
      // (bodyEncoding 'utf8' or absent, for backward compatibility with
      // an older hub/agent) passes through as a string, unchanged.
      const body =
        msg.bodyEncoding === "base64" && msg.body !== null
          ? Buffer.from(msg.body, "base64")
          : msg.body;

      pending.resolve({
        status: msg.status,
        headers: msg.headers,
        body,
        durationMs: msg.durationMs,
        isLocal: false,
      });
    } else {
      pending.reject(new TunnelError(msg.code, msg.message, msg.retryable));
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  isConnected(): boolean {
    return this.connected;
  }
  getSessionId(): string | null {
    return this.sessionId;
  }
  pendingCount(): number {
    return this.pending.size;
  }
}
