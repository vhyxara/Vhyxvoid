// apps/hub/src/handlers/HttpTunnelHandler.ts
//
// Handles plain HTTP requests arriving on tunnel subdomains.
//
// Flow:
//   1. Extract label + accountSlug from Host header
//   2. Look up SubdomainRegistry → get agentId
//   3. Find agent WebSocket in AgentRegistry
//   4. Forward request via tunnel:forward message
//   5. Wait for tunnel:response via PendingRegistry
//   6. Write real HTTP response back to caller
//
// This runs inside the existing http.createServer callback in HubServer.
// It does NOT use Fastify — the hub is a raw Node.js HTTP server.

import { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { AgentRegistry, PendingRegistry, TunnelWsRegistry, closeBrowserSocket } from '@/registry';
import { SubdomainRegistry } from '@/services/SubdomainRegistry.service';
import {
  TunnelForwardMsg,
  TunnelResponseMsg,
  TunnelWsCloseMsg,
  TunnelWsMessageMsg,
  TunnelWsOpenMsg,
  serialize,
  isBinaryContentType,
  isOriginFormPath,
  toSendableCloseCode,
} from '@vhyxvoid/protocol';
import type { Socket } from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { debugLog } from '@/utils/debug';
import { getTunnelRequestTimeoutMs } from '@/utils/tunnelTimeout';
import type { PublicPathUsageLimiter } from '@/services/PublicPathUsageLimiter.service';

// Max request body size — 10MB
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export class HttpTunnelHandler {
  constructor(
    private readonly subdomainRegistry: SubdomainRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly pendingRegistry: PendingRegistry,
    private readonly hubDomain: string, // e.g. "vhyxvoid.com"
    // One instance shared with nothing else today, but constructor-injectable so
    // HubServer owns its lifetime like every other registry. The default keeps
    // callers that only exercise the HTTP path (tests) unchanged.
    private readonly tunnelWsRegistry: TunnelWsRegistry = new TunnelWsRegistry(),
    // Optional so every existing test that constructs this with 4-5 args
    // keeps compiling unchanged; absent means no rate limiting or usage
    // counting happens on this path (only ever true in a test). See
    // shared/decision.md, 2026-09-22, "S5 investigation and proposal".
    private readonly usageLimiter?: PublicPathUsageLimiter,
  ) {}

  /**
   * Returns true if this request is a tunnel subdomain request.
   * Returns false if it should fall through to other handlers (health, metrics etc).
   */
  isTunnelRequest(req: IncomingMessage): boolean {
    const host = req.headers.host ?? '';
    // Strip port if present
    const hostname = host.split(':')[0];
    // NOTE: called on EVERY incoming HTTP request — must stay gated, not just
    // "debug-labeled", or it floods logs at real traffic volume.
    debugLog('[tunnel] isTunnelRequest check:', hostname, 'domain:', this.hubDomain);

    // Must end with our domain and have at least one subdomain segment
    if (!hostname.endsWith(`.${this.hubDomain}`)) return false;
    // Exclude the apex domain itself
    if (hostname === this.hubDomain) return false;
    return true;
  }

  /**
   * Handle a tunnel HTTP request end-to-end.
   * Writes the response directly to res.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? '';
    const hostname = host.split(':')[0];
    // CORS preflights (OPTIONS) are forwarded to the backend like any other
    // request, so the backend's own CORS policy decides. The hub used to
    // answer every preflight itself with the caller's Origin and
    // Allow-Credentials, letting any website make credentialed requests to
    // any tunnel. See shared/context.md Known Risk #60 (C4).

    // Parse subdomain — format: {label}.{accountSlug}.vhyxvoid.com
    // const subdomain = hostname.slice(0, -(this.hubDomain.length + 1)); // strip .vhyxvoid.com
    // const parts = subdomain.split('.');

    // if (parts.length < 2) {
    //   return this.sendError(
    //     res,
    //     400,
    //     'Invalid tunnel URL format. Expected: label.account.vhyxvoid.com',
    //   );
    // }

    // Last segment is accountSlug, everything before is the label
    // This allows labels with dots: "my.app.tanveer.vhyxvoid.com" → label=my.app, slug=tanveer
    // const accountSlug = parts[parts.length - 1];
    // const label = parts.slice(0, -1).join('.');
    const subdomain = hostname.slice(0, -(this.hubDomain.length + 1));
    const parsed = this.parseSubdomain(subdomain);

    if (!parsed) {
      return this.sendError(
        res,
        400,
        'Invalid tunnel URL. Expected format: accountslug--label.vhyxvoid.com',
      );
    }

    // An absolute-form request target (`GET http://host/… HTTP/1.1`) makes
    // req.url an absolute URL, which the agent would fetch instead of its
    // local backend (audit H9). nginx normalises the request line today;
    // this doesn't rely on it.
    if (!isOriginFormPath(req.url)) {
      return this.sendError(res, 400, 'Invalid request path');
    }

    const { label, accountSlug } = parsed;
    // Look up agent in Redis subdomain registry
    const entry = await this.subdomainRegistry.resolve(label, accountSlug);

    if (!entry) {
      return this.sendError(
        res,
        404,
        [
          `No active tunnel found for "${hostname}".`,
          `Start the agent with: vhyxvoid --key YOUR_KEY --secret YOUR_SECRET --port YOUR_PORT --label ${label}`,
        ].join(' '),
      );
    }

    // Per-account abuse limit on the public path — checked before the agent
    // lookup so a flood aimed at a URL with no agent connected is still
    // capped, not just one with a live agent behind it. See
    // shared/decision.md, 2026-09-22, "S5 investigation and proposal".
    if (this.usageLimiter) {
      const rateCheck = await this.usageLimiter.checkRequest(entry.accountId);
      if (!rateCheck.allowed) {
        return this.sendError(
          res,
          429,
          `Rate limit exceeded: ${rateCheck.limitPerMinute} requests/min for this account's plan`,
          {
            headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
            body: { retryAfterSeconds: rateCheck.retryAfterSeconds },
          },
        );
      }
    }

    // Get the agent's live WebSocket connection
    const agent = this.agentRegistry.findByAgentId(entry.agentId);

    if (!agent) {
      // Entry in Redis but agent not in registry — stale, clean it up.
      // Passing entry.agentId makes this a compare-and-delete (see
      // SubdomainRegistry.unregister) — if a real reconnect races this
      // cleanup and re-registers the label first, this becomes a correct
      // no-op instead of deleting the fresh, valid entry.
      await this.subdomainRegistry.unregister(label, accountSlug, entry.agentId);
      return this.sendError(
        res,
        503,
        [
          'Tunnel is registered but agent is not connected.',
          'The agent may have disconnected. Please restart it.',
        ].join(' '),
      );
    }

    // Read request body
    let body: string | null = null;
    let bodyEncoding: 'utf8' | 'base64' | undefined;
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);

    if (contentLength > MAX_BODY_BYTES) {
      return this.sendError(
        res,
        413,
        `Request body too large. Maximum is ${MAX_BODY_BYTES / 1024 / 1024}MB`,
      );
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const rawBuffer = await this.readBody(req, MAX_BODY_BYTES);
      if (rawBuffer.length > 0) {
        bodyEncoding = isBinaryContentType(req.headers['content-type']) ? 'base64' : 'utf8';
        body = rawBuffer.toString(bodyEncoding);
      }
    }

    // How long to wait for the agent to respond before returning 504
    const requestTimeoutMs = getTunnelRequestTimeoutMs();

    // Build forward message
    const requestId = `req_${randomUUID().replace(/-/g, '')}`;

    // Strip hop-by-hop headers before forwarding
    const forwardHeaders = this.sanitizeHeaders(req.headers as Record<string, string>);

    const forward: TunnelForwardMsg = {
      v: '1',
      type: 'tunnel:forward',
      requestId,
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      query: '',
      headers: forwardHeaders,
      body: body,
      bodyEncoding,
      timeoutMs: requestTimeoutMs - 2000,
    };

    // Enqueue pending request — resolve/reject when agent responds
    await new Promise<void>((outerResolve) => {
      const timer = setTimeout(() => {
        this.pendingRegistry.reject(requestId, 'AGENT_TIMEOUT', 'Agent did not respond in time');
        outerResolve();
      }, requestTimeoutMs);

      this.pendingRegistry.enqueue({
        requestId,
        accountId: entry.accountId,
        agentLabel: label,
        keyId: agent.keyId,
        enqueuedAt: Date.now(),

        resolve: (response: TunnelResponseMsg) => {
          clearTimeout(timer);
          this.writeResponse(res, response);
          outerResolve();
        },

        reject: (code: string, message: string) => {
          clearTimeout(timer);
          const status = code === 'AGENT_TIMEOUT' ? 504 : 502;
          this.sendError(res, status, message);
          outerResolve();
        },

        timer,
      });

      // Send to agent
      try {
        debugLog(
          '[tunnel] sending forward to agent:',
          agent.agentId,
          'ws readyState:',
          agent.ws.readyState,
        );
        agent.ws.send(serialize(forward as any));
      } catch (err) {
        console.error('[tunnel] send failed:', err);

        clearTimeout(timer);
        this.pendingRegistry.reject(requestId, 'SEND_FAILED', 'Failed to send request to agent');
        outerResolve();
      }
    });
  }

  async handleWebSocket(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    const host = req.headers.host ?? '';
    const hostname = host.split(':')[0];
    const subdomain = hostname.slice(0, -(this.hubDomain.length + 1));
    const parsed = this.parseSubdomain(subdomain);

    if (!parsed || !isOriginFormPath(req.url)) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const { label, accountSlug } = parsed;
    const entry = await this.subdomainRegistry.resolve(label, accountSlug);

    if (!entry) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const agent = this.agentRegistry.findByAgentId(entry.agentId);
    if (!agent) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    this.tunnelWss.handleUpgrade(req, socket, head, (browserWs) => {
      const connectionId = `ws_${randomUUID().replace(/-/g, '')}`;

      debugLog('[tunnel-ws] browser connected:', connectionId, req.url);

      // Register BEFORE telling the agent, so any frame or close the agent sends
      // back can already be attributed to (and checked against) its owner.
      this.tunnelWsRegistry.add({
        connectionId,
        accountId: entry.accountId,
        agentId: agent.agentId,
        browserWs,
        openedAt: Date.now(),
      });

      // A ws with no 'error' listener throws on error and takes the hub down;
      // an error is always followed by 'close', which does the cleanup.
      browserWs.on('error', (err) => {
        debugLog('[tunnel-ws] browser socket error:', connectionId, err.message);
      });

      // Tell agent to open WS to local backend
      const openMsg: TunnelWsOpenMsg = {
        v: '1',
        type: 'tunnel:ws:open',
        connectionId,
        path: req.url ?? '/',
        query: '',
        headers: this.sanitizeHeaders(req.headers as Record<string, string>),
      };
      agent.ws.send(serialize(openMsg as any));

      // Browser → Agent → Backend
      browserWs.on('message', (data: Buffer, isBinary: boolean) => {
        // Resolve the owning agent at send time, not at upgrade time: the agent
        // may have reconnected (new agentId) since, and the socket captured at
        // upgrade would now be dead.
        const owner = this.agentRegistry.findByAgentId(agent.agentId);
        if (!owner) {
          this.teardown(connectionId, 1012, 'Tunnel agent disconnected', false);
          return;
        }
        const msg: TunnelWsMessageMsg = {
          v: '1',
          type: 'tunnel:ws:message',
          connectionId,
          data: isBinary ? data.toString('base64') : data.toString('utf8'),
          isBinary,
        };
        try {
          owner.ws.send(serialize(msg));
        } catch {
          this.teardown(connectionId, 1011, 'Tunnel send failed', false);
        }
      });

      browserWs.on('close', (code, reason) => {
        // Already torn down from the agent side / by a dropped agent: nothing
        // left to notify or clean. (Also makes the teardown idempotent.)
        if (!this.tunnelWsRegistry.delete(connectionId)) return;
        this.notifyAgentClosed(agent.agentId, connectionId, code, reason.toString());
      });
    });
  }

  // ── Agent → browser tunnel:ws:* ────────────────────────────────────────────
  // Every handler takes the id of the agent the frame ARRIVED FROM (resolved by
  // the router from the sending socket) and only acts if that agent owns the
  // connection. connectionIds are unguessable, but an agent that learns one must
  // still not be able to inject into, or close, another account's browser socket.

  private ownedEntry(connectionId: string, fromAgentId: string) {
    const entry = this.tunnelWsRegistry.get(connectionId);
    if (!entry) return undefined;
    if (entry.agentId !== fromAgentId) {
      console.warn(
        { connectionId, fromAgentId, ownerAgentId: entry.agentId },
        '[tunnel-ws] ignoring tunnel:ws frame from an agent that does not own the connection',
      );
      return undefined;
    }
    return entry;
  }

  handleAgentWsMessage(msg: TunnelWsMessageMsg, fromAgentId: string): void {
    const entry = this.ownedEntry(msg.connectionId, fromAgentId);
    if (!entry || entry.browserWs.readyState !== WebSocket.OPEN) return;

    const payload = msg.isBinary ? Buffer.from(msg.data, 'base64') : msg.data;
    entry.browserWs.send(payload);
  }

  handleAgentWsClose(msg: TunnelWsCloseMsg, fromAgentId: string): void {
    if (!this.ownedEntry(msg.connectionId, fromAgentId)) return;
    this.teardown(msg.connectionId, msg.code, msg.reason, false);
  }

  handleAgentWsError(msg: { connectionId: string; message: string }, fromAgentId: string): void {
    if (!this.ownedEntry(msg.connectionId, fromAgentId)) return;
    // The agent's message is a raw local error (e.g. "connect ECONNREFUSED
    // 127.0.0.1:3000") — it names the developer's local port, so it stays in
    // the hub's logs and never reaches the browser.
    debugLog('[tunnel-ws] agent reported error:', msg.connectionId, msg.message);
    this.teardown(msg.connectionId, 1011, 'Tunnel backend error', false);
  }

  /** Closes every tunnel WebSocket owned by an agent whose hub link is gone. */
  closeAllForAgent(agentId: string, code: number, reason: string): number {
    return this.tunnelWsRegistry.closeAllForAgent(agentId, code, reason);
  }

  /**
   * Single teardown path for a tunnel WebSocket: removes it from the registry,
   * closes the browser socket (never leaving it open — see closeBrowserSocket),
   * and optionally tells the agent to close the backend side. Idempotent.
   */
  private teardown(connectionId: string, code: number, reason: string, notifyAgent: boolean): void {
    const entry = this.tunnelWsRegistry.delete(connectionId);
    if (!entry) return;
    closeBrowserSocket(entry.browserWs, code, reason);
    if (notifyAgent) this.notifyAgentClosed(entry.agentId, connectionId, code, reason);
  }

  private notifyAgentClosed(agentId: string, connectionId: string, code: number, reason: string): void {
    const owner = this.agentRegistry.findByAgentId(agentId);
    if (!owner) return;
    const msg: TunnelWsCloseMsg = {
      v: '1',
      type: 'tunnel:ws:close',
      connectionId,
      code: toSendableCloseCode(code),
      reason,
    };
    try {
      owner.ws.send(serialize(msg));
    } catch {
      // agent link already gone — its own cleanup closes the backend socket
    }
  }

  // ── Private helpers ───────────────────────────────────────

  private parseSubdomain(subdomain: string): { label: string; accountSlug: string } | null {
    const separatorIndex = subdomain.indexOf('--');
    if (separatorIndex === -1) return null;

    const accountSlug = subdomain.slice(0, separatorIndex); // ← first part is now slug
    const label = subdomain.slice(separatorIndex + 2); // ← second part is label

    if (!label || !accountSlug) return null;
    return { label, accountSlug };
  }

  private writeResponse(res: ServerResponse, response: TunnelResponseMsg): void {
    const headers = response.headers ?? {};

    // Prefer the explicit bodyEncoding the agent now sets (see
    // context.md risk #21) over content-type sniffing — sniffing stays as
    // the fallback for an older agent build that predates this field.
    const isBinary = response.bodyEncoding
      ? response.bodyEncoding === 'base64'
      : isBinaryContentType(headers['content-type']);
    const payload = response.body
      ? Buffer.from(response.body, isBinary ? 'base64' : 'utf8')
      : null;

    // The backend's headers pass through unmodified (minus hop-by-hop),
    // including its own CORS headers, Vary and Set-Cookie. The hub used to
    // drop the backend's CORS headers and substitute a reflected Origin with
    // credentials, and to rewrite every cookie to Domain=.<hubDomain>;
    // SameSite=None; Secure, which sent one tenant's cookies to every other
    // tenant's tunnel. No per-tunnel opt-in to cookie-domain sharing exists
    // yet; the full fix is a separate tunnel domain (audit A1). See
    // shared/context.md Known Risk #60 (C3/C4).
    for (const [key, value] of Object.entries(headers)) {
      if (this.isHopByHop(key)) continue;

      // Content-Length is recomputed from the bytes actually written below.
      // The agent's copy can be the backend's COMPRESSED length: axios
      // decompresses gzip/br/deflate but keeps the original header, and every
      // already-published agent forwards it, which truncated the body at the
      // caller (audit H5). A body-less response (HEAD, 204, 304) keeps the
      // agent's value, since there it describes a body that isn't sent.
      if (payload && key.toLowerCase() === 'content-length') continue;

      // The agent joins multiple Set-Cookie values with \n for transport;
      // each goes back out as its own header, byte-for-byte.
      if (key.toLowerCase() === 'set-cookie') {
        res.setHeader('set-cookie', value.split('\n').filter(Boolean));
        continue;
      }

      try {
        res.setHeader(key, value);
      } catch {
        // Invalid header
      }
    }

    res.setHeader('X-Tunnel-Duration', `${response.durationMs ?? 0}ms`);
    if (payload) res.setHeader('Content-Length', payload.length);

    res.writeHead(response.status ?? 200);
    res.end(payload ?? undefined);
  }

  private sendError(
    res: ServerResponse,
    status: number,
    message: string,
    extra?: { headers?: Record<string, string>; body?: Record<string, unknown> },
  ): void {
    const body = JSON.stringify({
      error: message,
      status,
      tunnel: true,
      ...(extra?.body ?? {}),
    });
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...(extra?.headers ?? {}),
    });
    res.end(body);
  }

  private readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          req.destroy();
          reject(new Error('Body too large'));
          return;
        }
        chunks.push(chunk);
      });

      // Returns the raw bytes rather than decoding here — the caller
      // decides utf8 vs base64 based on content-type (see
      // isBinaryContentType, imported from @vhyxvoid/protocol). Previously
      // this unconditionally did .toString('utf8'), which silently
      // corrupted any binary request body (e.g. a file uploaded through a
      // tunneled subdomain) before it ever reached TunnelForwardMsg.body —
      // the mirror image of the response-path bug fixed 2026-09-12. See
      // context.md risk #21.
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (this.isHopByHop(key)) continue;
      result[key] = value;
    }
    return result;
  }

  private isHopByHop(header: string): boolean {
    const hopByHop = new Set([
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
      'upgrade',
    ]);
    return hopByHop.has(header.toLowerCase());
  }

  private readonly tunnelWss = new WebSocketServer({ noServer: true });
}
