// packages/agent/src/proxy/BackendProxy.ts
// HTTP client to localhost. Never throws — always returns a response.
// Uses axios with validateStatus: () => true so 4xx/5xx pass through.

import axios, { AxiosInstance } from "axios";
import {
  TunnelForwardMsg,
  TunnelResponseMsg,
  LIMITS,
  isBinaryContentType,
  isOriginFormPath,
  toSendableCloseCode,
} from "@vhyxvoid/protocol";
import { ResponseCache } from "../cache/ResponseCache";
import WebSocket from "ws";
import type { Readable } from "stream";
import { debugLog } from "../debug";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

// Evict expired cache entries every 60 seconds
const CACHE_EVICT_INTERVAL_MS = 60_000;

/** Where a streamed response goes (AgentClient sends these to the hub). */
export interface StreamSink {
  start(status: number, headers: Record<string, string>): void;
  chunk(data: Buffer): void;
  end(durationMs: number, error?: string): void;
  /** True while the hub link has too much unsent data: pause reading. */
  backedUp(): boolean;
}

/** Streams by nature: relayed as they arrive when the caller allows it. */
export function isStreamingResponse(headers: Record<string, any>): boolean {
  const ct = String(headers["content-type"] ?? "").toLowerCase();
  if (ct.startsWith("text/event-stream")) return true;
  if (ct.includes("ndjson") || ct.includes("stream+json") || ct.startsWith("application/jsonl")) return true;
  // Chunked with no length: the backend itself is sending it piece by piece
  // (streaming SSR, progress output). Relay as it comes.
  const te = String(headers["transfer-encoding"] ?? "").toLowerCase();
  return te.includes("chunked") && headers["content-length"] === undefined;
}

async function collectStream(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      stream.destroy();
      throw new Error(`Response exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
// Frames a browser sends before the agent's socket to the backend is open.
const WS_PENDING_MAX_FRAMES = 256;
const WS_PENDING_MAX_BYTES = 4 * 1024 * 1024;

export class BackendProxy {
  private readonly client: AxiosInstance;
  private readonly cache = new ResponseCache();
  private evictTimer: NodeJS.Timeout | null = null;
  private readonly wsPending = new Map<string, { frames: (string | Buffer)[]; bytes: number }>();

  constructor(private port: number) {
    this.client = axios.create({
      baseURL: `http://127.0.0.1:${port}`,
      // Fallback only — forward() passes the hub's per-request timeoutMs.
      timeout: 28_000,
      maxContentLength: LIMITS.MAX_PAYLOAD_BYTES,
      maxBodyLength: LIMITS.MAX_PAYLOAD_BYTES,
      validateStatus: () => true,
      decompress: true,
      responseType: "arraybuffer",
      // Never let a path replace the base URL (audit H9): without this, an
      // absolute URL in path sent the request to that host instead.
      allowAbsoluteUrls: false,
    });

    // Periodic cache eviction
    this.evictTimer = setInterval(
      () => this.cache.evictExpired(),
      CACHE_EVICT_INTERVAL_MS,
    );
    // Don't prevent process exit
    this.evictTimer.unref?.();
  }

  /**
   * Forward one tunnelled request to the local backend. Returns the response
   * to send as a single tunnel:response, or null when it was streamed to
   * `sink` instead (only when the hub set acceptStream and the response is a
   * stream by nature). `signal` aborts the backend request (tunnel:cancel).
   */
  async forward(
    msg: TunnelForwardMsg,
    sink?: StreamSink,
    signal?: AbortSignal,
  ): Promise<Omit<TunnelResponseMsg, "v" | "type" | "requestId"> | null> {
    // ── Cache check (GET only) ────────────────────────────────────────────────
    const cached = this.cache.get(msg.method, msg.path, msg.query, msg.headers);
    if (cached) {
      return {
        status: cached.status,
        headers: { ...cached.headers, "x-vhyxvoid-cache": "HIT" },
        body: cached.body,
        bodyEncoding: cached.bodyEncoding,
        durationMs: 0, // served from memory
      };
    }

    // ── Path check (audit H9) ────────────────────────────────────────────────
    // Only an origin-form path ("/…") may reach the local backend. An absolute
    // or protocol-relative one would make this machine fetch another host.
    // The hub refuses these too; this is the agent's own line of defense.
    if (!isOriginFormPath(msg.path)) {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Invalid request path", tunnel: true }),
        bodyEncoding: "utf8",
        durationMs: 0,
      };
    }

    // ── Real HTTP request ─────────────────────────────────────────────────────
    const start = Date.now();
    const url = msg.path + (msg.query ? `?${msg.query}` : "");

    // The mirror image of the response-path fix below: when the hub set
    // bodyEncoding: 'base64' (a binary request body — e.g. a file
    // uploaded through a tunneled subdomain), msg.body is base64 text and
    // must be decoded back to real bytes before axios sends it, or the
    // local backend receives base64 text instead of the original file.
    // An older hub that never sets bodyEncoding is treated as utf8, same
    // as before. See context.md risk #21.
    let requestData: Buffer | string | undefined;
    if (msg.body && msg.body.length > 0) {
      requestData =
        msg.bodyEncoding === "base64" ? Buffer.from(msg.body, "base64") : msg.body;
    }

    const useStream = !!(msg.acceptStream && sink);
    const response = await this.client.request({
      method: msg.method,
      url,
      headers: this.sanitizeInboundHeaders(msg.headers),
      data: requestData,
      // Honor the hub's per-request budget (an older hub omits it → fallback).
      ...(msg.timeoutMs ? { timeout: msg.timeoutMs } : {}),
      // Streaming-capable callers get the body as a stream, so a response
      // that is a stream by nature (SSE, NDJSON, chunked) can be relayed as
      // it arrives; anything else is collected and sent in one piece.
      ...(useStream ? { responseType: "stream" as const } : {}),
      ...(signal ? { signal } : {}),
    });

    let bodyBuffer: Buffer;
    if (useStream) {
      const stream = response.data as Readable;
      if (isStreamingResponse(response.headers as Record<string, any>)) {
        this.relayStream(response, stream, sink!, start, signal);
        return null;
      }
      bodyBuffer = await collectStream(stream, LIMITS.MAX_PAYLOAD_BYTES);
    } else {
      bodyBuffer = response.data as Buffer;
    }

    const headers = this.sanitizeOutboundHeaders(
      response.headers as Record<string, any>,
    );
    // decompress: true inflates gzip/br/deflate and drops content-encoding,
    // but axios keeps the backend's COMPRESSED content-length. Report the
    // length of the bytes actually forwarded (audit H5; the hub recomputes it
    // too, for agents published before this fix). With no body (HEAD, 204,
    // 304) the backend's value is left alone: it describes a body not sent.
    if (bodyBuffer.length > 0) {
      headers["content-length"] = String(bodyBuffer.length);
    }
    const durationMs = Date.now() - start;

    // Previously this always did bodyBuffer.toString("utf8") regardless of
    // content type, which silently corrupts any binary response (images,
    // PDFs, etc.) — lossy UTF-8 decoding is not reversible, so by the time
    // the hub's content-type-based sniffing tried to Buffer.from(body,
    // 'base64') on the way back out, the bytes were already mangled. See
    // context.md risk #21 and decision.md, 2026-09-12, "tunnel:forward /
    // tunnel:response bodyEncoding".
    const isBinary = isBinaryContentType(headers["content-type"]);
    const bodyEncoding: "utf8" | "base64" = isBinary ? "base64" : "utf8";
    const bodyStr =
      bodyBuffer.length > 0 ? bodyBuffer.toString(bodyEncoding) : null;

    // ── Store in cache if cacheable ───────────────────────────────────────────
    this.cache.set(
      msg.method,
      msg.path,
      msg.query,
      {
        status: response.status,
        headers,
        body: bodyStr,
        bodyEncoding,
        durationMs,
      },
      msg.headers,
    );

    return {
      status: response.status,
      headers: { ...headers, "x-vhyxvoid-cache": "MISS" },
      body: bodyStr,
      bodyEncoding,
      durationMs,
    };
  }

  /** Relay a streaming backend response to the hub as it arrives. */
  private relayStream(
    response: { status: number; headers: Record<string, any>; request?: any },
    stream: Readable,
    sink: StreamSink,
    start: number,
    signal?: AbortSignal,
  ): void {
    const headers = this.sanitizeOutboundHeaders(response.headers);
    // Length and encoding describe the backend's framing, not what the hub
    // will send (chunked, already decompressed by axios).
    delete headers["content-length"];
    delete headers["content-encoding"];
    headers["x-vhyxvoid-stream"] = "1";
    // A stream may legitimately stay quiet for a long time (SSE keepalive
    // intervals): the request timeout only covers waiting for the headers.
    try {
      response.request?.setTimeout?.(0);
    } catch {
      // ignore
    }
    sink.start(response.status, headers);

    let ended = false;
    const finish = (error?: string) => {
      if (ended) return;
      ended = true;
      clearInterval(resumeTimer);
      sink.end(Date.now() - start, error);
    };
    // Backpressure: stop reading from the backend while the hub link is
    // backed up, resume when it drains.
    const resumeTimer = setInterval(() => {
      if (stream.isPaused() && !sink.backedUp()) stream.resume();
    }, 25);
    resumeTimer.unref?.();
    stream.on("data", (chunk: Buffer) => {
      sink.chunk(chunk);
      if (sink.backedUp()) stream.pause();
    });
    stream.on("end", () => finish());
    stream.on("error", (err: Error) => finish(signal?.aborted ? "canceled" : err.message));
    stream.on("close", () => finish(signal?.aborted ? "canceled" : undefined));
  }

  /** Switch to another local port (AgentClient.setPort). Cached responses
   * came from the old backend, so the cache is cleared. */
  setPort(port: number): void {
    this.port = port;
    this.client.defaults.baseURL = `http://127.0.0.1:${port}`;
    this.cache.clear();
  }

  /** Invalidate cached GETs related to a mutating request path */
  invalidateCacheFor(method: string, path: string): void {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
      // Invalidate the base path and common related paths
      const basePath = path.split("/").slice(0, -1).join("/");
      this.cache.invalidatePrefix(basePath || path);
    }
  }

  getCacheStats() {
    return this.cache.stats();
  }

  stop(): void {
    if (this.evictTimer) {
      clearInterval(this.evictTimer);
      this.evictTimer = null;
    }
    this.cache.clear();
    this.closeAllWebSockets();
  }

  private sanitizeInboundHeaders(
    headers: Record<string, string>,
  ): Record<string, string> {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) clean[k] = v;
    }
    // Override host to localhost — backend rejects tunnel domain host headers
    clean["host"] = `127.0.0.1:${this.port}`;
    clean["x-forwarded-by"] = "vhyxvoid";
    clean["x-forwarded-host"] = `127.0.0.1:${this.port}`;
    return clean;
  }
  private sanitizeOutboundHeaders(
    headers: Record<string, any>,
  ): Record<string, string> {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;

      if (k.toLowerCase() === "set-cookie") {
        // axios returns set-cookie as string[] — join with \n for transport
        // hub splits on \n and re-emits as separate Set-Cookie headers
        if (Array.isArray(v)) {
          clean[k] = v.join("\n");
        } else if (typeof v === "string") {
          clean[k] = v;
        }
        continue;
      }

      if (typeof v === "string") clean[k] = v;
      else if (Array.isArray(v)) clean[k] = v[0]; // take first for other multi-value headers
    }
    return clean;
  }

  private readonly wsConnections = new Map<string, WebSocket>();

  /**
   * Open a WebSocket connection to the local backend.
   * onMessage: called when backend sends a message to forward to hub
   * onClose: called when backend closes the connection
   */
  openWebSocket(
    connectionId: string,
    path: string,
    query: string,
    headers: Record<string, string>,
    onMessage: (data: string, isBinary: boolean) => void,
    onClose: (code: number, reason: string) => void,
    onError: (message: string) => void,
  ): void {
    // The URL is plain concatenation, so a path not starting with a single
    // "/" could redirect it ("@evil.com/x" makes 127.0.0.1:<port> userinfo).
    if (!isOriginFormPath(path)) {
      onError("Invalid request path");
      return;
    }
    const url = `ws://127.0.0.1:${this.port}${path}${query ? "?" + query : ""}`;

    // Override host header
    const wsHeaders = { ...headers, host: `127.0.0.1:${this.port}` };

    const ws = new WebSocket(url, { headers: wsHeaders });
    this.wsConnections.set(connectionId, ws);

    ws.on("open", () => {
      debugLog("[proxy] WS opened to backend:", path);
      // The browser side is already open (the hub answered its upgrade), so
      // frames it sent right away arrived before this socket was ready.
      // Deliver them now, in order.
      const pending = this.wsPending.get(connectionId);
      this.wsPending.delete(connectionId);
      for (const frame of pending?.frames ?? []) ws.send(frame);
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      const encoded = isBinary
        ? data.toString("base64")
        : data.toString("utf8");
      onMessage(encoded, isBinary);
    });

    ws.on("close", (code, reason) => {
      this.wsConnections.delete(connectionId);
      this.wsPending.delete(connectionId);
      onClose(code, reason.toString());
    });

    ws.on("error", (err) => {
      this.wsConnections.delete(connectionId);
      this.wsPending.delete(connectionId);
      onError(err.message);
    });
  }

  sendWebSocketMessage(
    connectionId: string,
    data: string,
    isBinary: boolean,
  ): void {
    const ws = this.wsConnections.get(connectionId);
    if (!ws) return;

    const payload = isBinary ? Buffer.from(data, "base64") : data;
    if (ws.readyState === WebSocket.CONNECTING) {
      // Hold until the backend socket opens (see openWebSocket). Bounded:
      // past the cap the connection is failed rather than silently dropping
      // frames out of the middle of a stream.
      const pending = this.wsPending.get(connectionId) ?? { frames: [], bytes: 0 };
      const size = typeof payload === "string" ? Buffer.byteLength(payload) : payload.length;
      if (pending.frames.length >= WS_PENDING_MAX_FRAMES || pending.bytes + size > WS_PENDING_MAX_BYTES) {
        this.wsPending.delete(connectionId);
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        return;
      }
      pending.frames.push(payload);
      pending.bytes += size;
      this.wsPending.set(connectionId, pending);
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(payload);
  }

  closeWebSocket(connectionId: string, code: number, reason: string): void {
    const ws = this.wsConnections.get(connectionId);
    if (!ws) return;
    // Sanitize close code — `ws` throws for 1005/1006/1015 and other reserved
    // values; the hub can relay any of them (see closeCode.ts).
    const safeCode = toSendableCloseCode(code);
    try {
      ws.close(safeCode, reason);
    } catch {
      try {
        ws.terminate();
      } catch {
        // Ignore
      }
    }
    this.wsConnections.delete(connectionId);
    this.wsPending.delete(connectionId);
  }

  closeAllWebSockets(): void {
    this.wsPending.clear();
    for (const ws of this.wsConnections.values()) {
      try {
        ws.close();
      } catch {
        ws.terminate();
      }
    }
    this.wsConnections.clear();
  }
}
