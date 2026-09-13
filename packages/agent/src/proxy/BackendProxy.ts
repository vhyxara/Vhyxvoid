// packages/agent/src/proxy/BackendProxy.ts
// HTTP client to localhost. Never throws — always returns a response.
// Uses axios with validateStatus: () => true so 4xx/5xx pass through.

import axios, { AxiosInstance } from "axios";
import {
  TunnelForwardMsg,
  TunnelResponseMsg,
  LIMITS,
} from "@vhyxvoid/protocol";
import { ResponseCache } from "../cache/ResponseCache";
import WebSocket from "ws";

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

export class BackendProxy {
  private readonly client: AxiosInstance;
  private readonly cache = new ResponseCache();
  private evictTimer: NodeJS.Timeout | null = null;

  constructor(private readonly port: number) {
    this.client = axios.create({
      baseURL: `http://127.0.0.1:${port}`,
      timeout: 28_000,
      maxContentLength: LIMITS.MAX_PAYLOAD_BYTES,
      maxBodyLength: LIMITS.MAX_PAYLOAD_BYTES,
      validateStatus: () => true,
      decompress: true,
      responseType: "arraybuffer",
    });

    // Periodic cache eviction
    this.evictTimer = setInterval(
      () => this.cache.evictExpired(),
      CACHE_EVICT_INTERVAL_MS,
    );
    // Don't prevent process exit
    this.evictTimer.unref?.();
  }

  async forward(
    msg: TunnelForwardMsg,
  ): Promise<Omit<TunnelResponseMsg, "v" | "type" | "requestId">> {
    // ── Cache check (GET only) ────────────────────────────────────────────────
    const cached = this.cache.get(msg.method, msg.path, msg.query);
    if (cached) {
      return {
        status: cached.status,
        headers: { ...cached.headers, "x-vhyxvoid-cache": "HIT" },
        body: cached.body,
        bodyEncoding: cached.bodyEncoding,
        durationMs: 0, // served from memory
      };
    }

    // ── Real HTTP request ─────────────────────────────────────────────────────
    const start = Date.now();
    const url = msg.path + (msg.query ? `?${msg.query}` : "");

    const response = await this.client.request({
      method: msg.method,
      url,
      headers: this.sanitizeInboundHeaders(msg.headers),
      data: msg.body && msg.body.length > 0 ? msg.body : undefined,
    });

    const bodyBuffer = response.data as Buffer;
    const headers = this.sanitizeOutboundHeaders(
      response.headers as Record<string, any>,
    );
    const durationMs = Date.now() - start;

    // Previously this always did bodyBuffer.toString("utf8") regardless of
    // content type, which silently corrupts any binary response (images,
    // PDFs, etc.) — lossy UTF-8 decoding is not reversible, so by the time
    // the hub's content-type-based sniffing tried to Buffer.from(body,
    // 'base64') on the way back out, the bytes were already mangled. See
    // context.md risk #21 and decision.md, 2026-09-12, "tunnel:forward /
    // tunnel:response bodyEncoding".
    const isBinary = this.isBinaryContentType(headers["content-type"]);
    const bodyEncoding: "utf8" | "base64" = isBinary ? "base64" : "utf8";
    const bodyStr =
      bodyBuffer.length > 0 ? bodyBuffer.toString(bodyEncoding) : null;

    // ── Store in cache if cacheable ───────────────────────────────────────────
    this.cache.set(msg.method, msg.path, msg.query, {
      status: response.status,
      headers,
      body: bodyStr,
      bodyEncoding,
      durationMs,
    });

    return {
      status: response.status,
      headers: { ...headers, "x-vhyxvoid-cache": "MISS" },
      body: bodyStr,
      bodyEncoding,
      durationMs,
    };
  }

  private isBinaryContentType(contentType: string | undefined): boolean {
    const ct = (contentType ?? "").toLowerCase();
    return (
      ct.includes("image/") ||
      ct.includes("application/pdf") ||
      ct.includes("application/octet-stream") ||
      ct.includes("audio/") ||
      ct.includes("video/") ||
      ct.includes("font/") ||
      ct.includes("application/zip")
    );
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
    const url = `ws://127.0.0.1:${this.port}${path}${query ? "?" + query : ""}`;

    // Override host header
    const wsHeaders = { ...headers, host: `127.0.0.1:${this.port}` };

    const ws = new WebSocket(url, { headers: wsHeaders });
    this.wsConnections.set(connectionId, ws);

    ws.on("open", () => {
      console.log("[proxy] WS opened to backend:", path);
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      const encoded = isBinary
        ? data.toString("base64")
        : data.toString("utf8");
      onMessage(encoded, isBinary);
    });

    ws.on("close", (code, reason) => {
      this.wsConnections.delete(connectionId);
      onClose(code, reason.toString());
    });

    ws.on("error", (err) => {
      this.wsConnections.delete(connectionId);
      onError(err.message);
    });
  }

  sendWebSocketMessage(
    connectionId: string,
    data: string,
    isBinary: boolean,
  ): void {
    const ws = this.wsConnections.get(connectionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const payload = isBinary ? Buffer.from(data, "base64") : data;
    ws.send(payload);
  }

  closeWebSocket(connectionId: string, code: number, reason: string): void {
    const ws = this.wsConnections.get(connectionId);
    if (!ws) return;
    // Sanitize close code — ws library only accepts 1000 or 3000-4999
    const safeCode = code >= 1000 && code <= 4999 ? code : 1000;
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
  }

  closeAllWebSockets(): void {
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
