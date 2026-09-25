// Simple HTTP client that routes requests through the tunnel URL.
// No WebSocket needed — just fetch to https://accountslug--label.vhyxvoid.com
//
// Usage:
//   const api = createClient({ label: 'default' })
//   const data = await api.get('/admin/users')
//   const result = await api.post('/admin/orders', { body: order })

import { isBinaryContentType } from "@vhyxvoid/protocol";

export interface ClientConfig {
  /** Your account slug: the part of your tunnel URL before `--`. The agent prints your full URL when it connects. Env: `VHYXVOID_ACCOUNT_SLUG`. */
  accountSlug?: string;
  /** Tunnel label to target. Default: 'default'. Env: VHYXVOID_LABEL */
  label?: string;
  /** Override tunnel base URL entirely (useful for testing) */
  baseUrl?: string;
  /** Hub domain. Default: vhyxvoid.com. Env: VHYXVOID_HUB_DOMAIN */
  hubDomain?: string;
  /** Default headers added to every request */
  headers?: Record<string, string>;
  /** Request timeout in ms. Default: 30000 */
  timeout?: number;
  /** Called before every request — useful for auth token injection */
  onRequest?: (req: RequestInit & { url: string }) => void | Promise<void>;
}

export interface ClientResponse<T = unknown> {
  data: T;
  status: number;
  headers: Record<string, string>;
  ok: boolean;
}

export class ClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown,
    public readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "ClientError";
  }
}

export class VhyxvoidClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: number;
  private readonly onRequest?: ClientConfig["onRequest"];

  constructor(config: ClientConfig = {}) {
    const accountSlug =
      config.accountSlug ?? process.env.VHYXVOID_ACCOUNT_SLUG ?? "";

    const label = config.label ?? process.env.VHYXVOID_LABEL ?? "default";

    const hubDomain =
      config.hubDomain ?? process.env.VHYXVOID_HUB_DOMAIN ?? "vhyxvoid.com";

    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/$/, "");
    } else if (accountSlug) {
      this.baseUrl = `https://${accountSlug}--${label}.${hubDomain}`;
    } else {
      throw new Error(
        "[vhyxvoid] createClient requires accountSlug or baseUrl.\n" +
          "  Set VHYXVOID_ACCOUNT_SLUG in your .env or pass it explicitly.",
      );
    }

    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...config.headers,
    };
    this.timeout = config.timeout ?? 30_000;
    this.onRequest = config.onRequest;
  }

  // ── Core ────────────────────────────────────────────────────────────────────

  async request<T = unknown>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      query?: Record<string, string>;
    } = {},
  ): Promise<ClientResponse<T>> {
    let url = `${this.baseUrl}${path.startsWith("/") ? path : "/" + path}`;

    if (options.query && Object.keys(options.query).length > 0) {
      url += "?" + new URLSearchParams(options.query).toString();
    }

    const headers = { ...this.defaultHeaders, ...options.headers };

    const init: RequestInit = {
      method,
      headers,
      body: options.body != null ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    };

    await this.onRequest?.({ url, ...init });

    const res = await fetch(url, init);

    // Parse response. This client talks HTTP directly to the tunnel
    // subdomain (not the WS sdk:response path), so it already receives
    // correctly-encoded bytes on the wire once the hub/agent side base64
    // a binary body (context.md risk #21's response-path fix) — there's
    // no bodyEncoding field to consume here. But res.text() itself is
    // lossy for binary content (it forces a UTF-8 decode), which was a
    // separate, real corruption bug in this file discovered while
    // verifying this exact class of issue — use res.arrayBuffer() instead
    // for binary content-types so callers get real bytes back.
    const contentType = res.headers.get("content-type") ?? "";
    let data: T;
    if (contentType.includes("application/json")) {
      data = (await res.json()) as T;
    } else if (isBinaryContentType(contentType)) {
      data = Buffer.from(await res.arrayBuffer()) as unknown as T;
    } else {
      data = (await res.text()) as unknown as T;
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (!res.ok) {
      throw new ClientError(res.status, data, url);
    }

    return { data, status: res.status, headers: responseHeaders, ok: res.ok };
  }

  // ── Convenience methods ─────────────────────────────────────────────────────

  get<T = unknown>(
    path: string,
    query?: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<ClientResponse<T>> {
    return this.request<T>("GET", path, { query, headers });
  }

  post<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ClientResponse<T>> {
    return this.request<T>("POST", path, { body, headers });
  }

  put<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ClientResponse<T>> {
    return this.request<T>("PUT", path, { body, headers });
  }

  patch<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ClientResponse<T>> {
    return this.request<T>("PATCH", path, { body, headers });
  }

  delete<T = unknown>(
    path: string,
    headers?: Record<string, string>,
  ): Promise<ClientResponse<T>> {
    return this.request<T>("DELETE", path, { headers });
  }

  // ── Tunnel URL ──────────────────────────────────────────────────────────────

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

/**
 * Create an HTTP client that routes requests through your tunnel.
 *
 * @example
 * // Reads VHYXVOID_ACCOUNT_SLUG and VHYXVOID_LABEL from env
 * const api = createClient()
 * const { data } = await api.get('/admin/users')
 *
 * // Explicit config
 * const api = createClient({ accountSlug: 'acme', label: 'default' })
 *
 * // With auth header
 * const api = createClient({
 *   accountSlug: 'acme',
 *   onRequest: async (req) => {
 *     req.headers['Authorization'] = `Bearer ${await getToken()}`
 *   }
 * })
 */
export function createClient(config: ClientConfig = {}): VhyxvoidClient {
  return new VhyxvoidClient(config);
}
