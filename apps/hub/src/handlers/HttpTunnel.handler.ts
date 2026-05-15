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
import { AgentRegistry, PendingRegistry } from '@/registry';
import { SubdomainRegistry } from '@/services/SubdomainRegistry.service';
import {
  TunnelForwardMsg,
  TunnelResponseMsg,
  TunnelWsCloseMsg,
  TunnelWsMessageMsg,
  TunnelWsOpenMsg,
  serialize,
} from '@vhyxvoid/protocol';
import type { Socket } from 'net';
// import { WsConnectionRegistry } from '@/registry/WsConnection.registry';
import { WebSocketServer, WebSocket } from 'ws';

// How long to wait for the agent to respond before returning 504
const REQUEST_TIMEOUT_MS = 30_000;

// Max request body size — 10MB
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export class HttpTunnelHandler {
  constructor(
    private readonly subdomainRegistry: SubdomainRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly pendingRegistry: PendingRegistry,
    private readonly hubDomain: string, // e.g. "vhyxvoid.com"
    // private readonly wsRegistry: WsConnectionRegistry,
  ) {}

  /**
   * Returns true if this request is a tunnel subdomain request.
   * Returns false if it should fall through to other handlers (health, metrics etc).
   */
  isTunnelRequest(req: IncomingMessage): boolean {
    const host = req.headers.host ?? '';
    // Strip port if present
    const hostname = host.split(':')[0];
    console.log('[tunnel] isTunnelRequest check:', hostname, 'domain:', this.hubDomain);

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
    if (req.method === 'OPTIONS') {
      const origin = req.headers.origin ?? '*';
      const requestedHeaders =
        req.headers['access-control-request-headers'] ?? 'Content-Type, Authorization';

      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': requestedHeaders,
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
        'Content-Length': '0',
      });
      res.end();
      return;
    }
    // if (req.method === 'OPTIONS') {
    //   res.writeHead(204, {
    //     'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    //     'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    //     'Access-Control-Allow-Headers':
    //       'Content-Type, Authorization, X-Requested-With, X-API-Key, X-API-Secret',
    //     'Access-Control-Max-Age': '86400',
    //     'Content-Length': '0',
    //   });
    //   res.end();
    //   return;
    // }

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

    // Get the agent's live WebSocket connection
    const agent = this.agentRegistry.findByAgentId(entry.agentId);

    if (!agent) {
      // Entry in Redis but agent not in registry — stale, clean it up
      await this.subdomainRegistry.unregister(label, accountSlug);
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
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);

    if (contentLength > MAX_BODY_BYTES) {
      return this.sendError(
        res,
        413,
        `Request body too large. Maximum is ${MAX_BODY_BYTES / 1024 / 1024}MB`,
      );
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await this.readBody(req, MAX_BODY_BYTES);
    }

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
      timeoutMs: REQUEST_TIMEOUT_MS - 2000,
    };

    // Enqueue pending request — resolve/reject when agent responds
    await new Promise<void>((outerResolve) => {
      const timer = setTimeout(() => {
        this.pendingRegistry.reject(requestId, 'AGENT_TIMEOUT', 'Agent did not respond in time');
        outerResolve();
      }, REQUEST_TIMEOUT_MS);

      this.pendingRegistry.enqueue({
        requestId,
        accountId: entry.accountId,
        agentLabel: label,
        keyId: agent.keyId,
        enqueuedAt: Date.now(),

        resolve: (response: TunnelResponseMsg) => {
          clearTimeout(timer);
          this.writeResponse(res, response, req);
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
        console.log(
          '[tunnel] sending forward to agent:',
          agent.agentId,
          'ws readyState:',
          agent.ws.readyState,
        );
        agent.ws.send(serialize(forward as any));
      } catch (err) {
        console.log('[tunnel] send failed:', err);

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

    if (!parsed) {
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

    // Create a local WSS to handle the browser WebSocket upgrade
    const wss = new WebSocketServer({ noServer: true });

    wss.handleUpgrade(req, socket, head, (browserWs) => {
      const connectionId = `ws_${randomUUID().replace(/-/g, '')}`;

      console.log('[tunnel-ws] browser connected:', connectionId, req.url);

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
        const msg: TunnelWsMessageMsg = {
          v: '1',
          type: 'tunnel:ws:message',
          connectionId,
          data: isBinary ? data.toString('base64') : data.toString('utf8'),
          isBinary,
        };
        agent.ws.send(serialize(msg as any));
      });

      browserWs.on('close', (code, reason) => {
        const msg: TunnelWsCloseMsg = {
          v: '1',
          type: 'tunnel:ws:close',
          connectionId,
          code,
          reason: reason.toString(),
        };
        try {
          agent.ws.send(serialize(msg as any));
        } catch {
          // ignore
        }
        // this.pendingRegistry['wsConnections']?.delete(connectionId);
        this.activeBrowserWs.delete(connectionId);
      });

      // Store browser WS so agent responses can find it
      // Reuse PendingRegistry pattern — store in a simple map on the handler
      this.activeBrowserWs.set(connectionId, browserWs);
    });
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

  private writeResponse(
    res: ServerResponse,
    response: TunnelResponseMsg,
    req: IncomingMessage,
  ): void {
    const headers = response.headers ?? {};

    for (const [key, value] of Object.entries(headers)) {
      if (this.isHopByHop(key)) continue;
      if (key.toLowerCase().startsWith('access-control-')) continue;
      if (key.toLowerCase() === 'vary') continue;

      // set-cookie must be sent as separate headers — split on \n
      if (key.toLowerCase() === 'set-cookie') {
        const cookies = value.split('\n').filter(Boolean);
        const rewritten = cookies.map((cookie) => {
          // Remove existing Domain attribute if present
          const withoutDomain = cookie.replace(/;\s*Domain=[^;]*/gi, '');
          // Remove existing SameSite — we'll set it correctly
          const withoutSameSite = withoutDomain.replace(/;\s*SameSite=[^;]*/gi, '');
          // Inject our domain — makes cookie available across all *.vhyxvoid.com
          return `${withoutSameSite}; Domain=.${this.hubDomain}; SameSite=None; Secure`;
        });
        for (const cookie of rewritten) {
          res.setHeader('set-cookie', [
            ...((res.getHeader('set-cookie') as string[]) ?? []),
            cookie,
          ]);
        }
        continue;
      }

      try {
        res.setHeader(key, value);
      } catch {
        // Invalid header
      }
    }

    // Hub owns CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] ??
        'Content-Type, Authorization, X-Requested-With, Cookie',
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Tunnel-Duration');
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Tunnel-Duration', `${response.durationMs ?? 0}ms`);

    res.writeHead(response.status ?? 200);

    if (!response.body) {
      res.end();
      return;
    }

    const contentType = (headers['content-type'] ?? '').toLowerCase();
    const isBinary =
      contentType.includes('image/') ||
      contentType.includes('application/pdf') ||
      contentType.includes('application/octet-stream') ||
      contentType.includes('audio/') ||
      contentType.includes('video/');

    if (isBinary) {
      res.end(Buffer.from(response.body, 'base64'));
    } else {
      res.end(response.body);
    }
  }

  private sendError(res: ServerResponse, status: number, message: string): void {
    const body = JSON.stringify({
      error: message,
      status,
      tunnel: true,
    });
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  private readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
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

      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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

  // Add to class:
  private readonly activeBrowserWs = new Map<string, WebSocket>();

  // Called by MessageRouter when agent sends tunnel:ws:* messages back
  handleAgentWsMessage(msg: TunnelWsMessageMsg): void {
    const ws = this.activeBrowserWs.get(msg.connectionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const payload = msg.isBinary ? Buffer.from(msg.data, 'base64') : msg.data;
    ws.send(payload);
  }

  handleAgentWsClose(msg: TunnelWsCloseMsg): void {
    const ws = this.activeBrowserWs.get(msg.connectionId);
    if (!ws) return;
    try {
      ws.close(msg.code, msg.reason);
    } catch {
      // Ignore
    }
    this.activeBrowserWs.delete(msg.connectionId);
  }

  handleAgentWsError(msg: { connectionId: string; message: string }): void {
    const ws = this.activeBrowserWs.get(msg.connectionId);
    if (!ws) return;
    try {
      ws.close(1011, msg.message);
    } catch {
      // Ignore
    }
    this.activeBrowserWs.delete(msg.connectionId);
  }
}
