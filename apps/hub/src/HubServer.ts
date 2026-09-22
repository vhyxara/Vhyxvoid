// apps/hub/src/HubServer.ts
// uWebSockets.js server — maximum throughput (~1.2M msg/sec per core).
// Two WS endpoints: /agent (agent connections) and /sdk (SDK TunnelClient connections).
// Health + metrics endpoints for load balancer probes.

// import uWS from 'uWebSockets.js';
import { Redis } from '@upstash/redis';
import { v4 as uuid } from 'uuid';
import { AgentRegistry } from '@/registry/Agent.registry';
import { SdkRegistry } from '@/registry/Sdk.registry';
import { PendingRegistry } from '@/registry/Pending.registry';
import { TunnelWsRegistry } from '@/registry/TunnelWs.registry';
import { MessageRouter } from '@/router/Message.router';
import { HubAuthService } from '@/services/HubAuth.service';
import { HeartbeatService } from '@/services/Heartbeat.service';
import { AccountStatusSweepService } from '@/services/AccountStatusSweep.service';
import { HubUsageService } from '@/services/HubUsage.service';
import { PublicPathUsageLimiter } from '@/services/PublicPathUsageLimiter.service';
import { HubPubSub } from '@/services/HubPubSub';
import { TunnelRequestRepository } from '@/repositories/TunnelRequest.repository';
import { IValidateApiKeyUseCase } from '@vhyxvoid/shared';
import { TunnelSessionRepository } from '@/repositories/TunnelSession.repository';
// const uWS = require('uWebSockets.js');
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { SubdomainRegistry } from './services/SubdomainRegistry.service';
import { HttpTunnelHandler } from './handlers/HttpTunnel.handler';
import WebSocket from 'ws';
import { isInternalRequestAuthorized } from '@/utils/internalAuth';

interface WebSocketWithMeta extends WebSocket {
  meta: {
    connectedAt: number;
    ip: string | undefined;
    type: 'agent' | 'sdk';
  };
}

export interface HubServerConfig {
  port: number;
  hubInstanceId?: string;
  redis: Redis;
  hubDomain: string; // ← ADD e.g. "vhyxvoid.com"
  pepper: string; // ← ADD
  loadKeyHash: (keyId: string) => Promise<{
    secretHash: string;
    accountId: string;
    scopes: string[];
    status: string;
    accountStatus: string;
  } | null>; // ← ADD

  validateKeyUseCase: IValidateApiKeyUseCase;
  tunnelSessionRepo: TunnelSessionRepository;
  tunnelRequestRepo: TunnelRequestRepository;

  /**
   * Shared secret required on every /internal/proxy request (header
   * `x-hub-internal-secret`), checked with a timing-safe comparison.
   * No caller exists yet (HUB_INTERNAL_URL in apps/api has no wired-up
   * caller — see context.md's Configuration table), so this intentionally
   * fails CLOSED when unset: every /internal/proxy request is rejected
   * with 503 rather than silently falling back to "no auth required".
   * See context.md risk #7 and decision.md, 2026-09-12, "internal/proxy
   * authentication".
   */
  internalSecret?: string;
}

export class HubServer {
  private readonly hubInstanceId: string;
  private readonly agentRegistry: AgentRegistry;
  private readonly sdkRegistry: SdkRegistry;
  private readonly pendingRegistry: PendingRegistry;
  private readonly heartbeat: HeartbeatService;
  private readonly statusSweep: AccountStatusSweepService;
  private readonly usageService: HubUsageService;
  private readonly publicPathUsageLimiter: PublicPathUsageLimiter;
  private readonly pubsub: HubPubSub;
  private readonly router: MessageRouter;
  // private listenSocket: any = null;
  public readonly pendingRequests = new Map<string, (response: unknown) => void>();
  private readonly subdomainRegistry: SubdomainRegistry;
  private readonly httpTunnelHandler: HttpTunnelHandler;
  constructor(private readonly config: HubServerConfig) {
    this.hubInstanceId = config.hubInstanceId ?? `hub_${uuid().replace(/-/g, '').slice(0, 12)}`;

    // ── Registries ───────────────────────────────────────────────────────────
    this.agentRegistry = new AgentRegistry();
    this.sdkRegistry = new SdkRegistry();
    this.pendingRegistry = new PendingRegistry(config.redis);

    // ── Services ─────────────────────────────────────────────────────────────
    const authService = new HubAuthService(
      config.validateKeyUseCase,
      config.pepper,
      config.loadKeyHash,
    );
    this.usageService = new HubUsageService(config.redis);

    this.heartbeat = new HeartbeatService(
      this.agentRegistry,
      this.pendingRegistry,
      config.tunnelSessionRepo,
      config.redis,
      this.hubInstanceId,
    );

    this.pubsub = new HubPubSub(
      config.redis,
      this.hubInstanceId,
      () => {}, // cross-hub forward handler — wired in Phase 2 (multi-hub)
    );

    this.subdomainRegistry = new SubdomainRegistry(config.redis);

    // context.md Known Risk #57 (E3, E5): per-account rate limiting and
    // usage counting for the public tunnel-URL path, which has no API key
    // to hang either on. See shared/decision.md, 2026-09-22, "S5
    // investigation and proposal".
    this.publicPathUsageLimiter = new PublicPathUsageLimiter(
      config.tunnelSessionRepo,
      this.usageService,
    );

    this.httpTunnelHandler = new HttpTunnelHandler(
      this.subdomainRegistry,
      this.agentRegistry,
      this.pendingRegistry,
      config.hubDomain,
      new TunnelWsRegistry(),
      this.publicPathUsageLimiter,
    );

    // context.md Known Risk #57 (E6): closes the "no status check exists on
    // live traffic" gap — a connected agent's account was never re-checked
    // after the handshake. See shared/decision.md, 2026-09-22, "S4".
    this.statusSweep = new AccountStatusSweepService(
      this.agentRegistry,
      this.pendingRegistry,
      config.tunnelSessionRepo,
      this.httpTunnelHandler,
      config.redis,
    );

    // ── Router ───────────────────────────────────────────────────────────────
    this.router = new MessageRouter(
      this.agentRegistry,
      this.sdkRegistry,
      this.pendingRegistry,
      authService,
      this.heartbeat,
      this.usageService,
      this.pubsub,
      config.tunnelSessionRepo,
      config.tunnelRequestRepo,
      this.hubInstanceId,
      this.subdomainRegistry, // ← ADD
      config.hubDomain,
      this.httpTunnelHandler,
    );
  }

  /**
   * Checks the `x-hub-internal-secret` header against config.internalSecret.
   * Delegates to the pure, directly-unit-tested isInternalRequestAuthorized()
   * in utils/internalAuth.ts.
   */
  private checkInternalAuth(req: import('http').IncomingMessage): boolean {
    return isInternalRequestAuthorized(
      req.headers['x-hub-internal-secret'],
      this.config.internalSecret,
    );
  }

  // ADD TO HubServer class:
  resolveRequest(requestId: string, response: unknown): void {
    const resolver = this.pendingRequests.get(requestId);
    if (resolver) {
      this.pendingRequests.delete(requestId);
      resolver(response);
    }
  }
  async start(): Promise<void> {
    // Clean up stale CONNECTED sessions from a previous crash of this hub instance
    await this.config.tunnelSessionRepo
      .evictStaleForInstance(this.hubInstanceId)
      .catch((err: Error) => console.warn('[hub] failed to evict stale sessions', err));

    // Clean up stale subdomain Redis keys from previous crash
    await this.subdomainRegistry
      .unregisterAllForHub(this.hubInstanceId)
      .catch((err: Error) => console.warn('[hub] failed to clean stale subdomain keys', err));

    await this.pubsub.start();
    this.heartbeat.start();
    this.statusSweep.start();
    this.publicPathUsageLimiter.start();

    const server = createServer(async (req, res) => {
      // ── Health check ──────────────────────────────────────────
      if (req.url === '/health') {
        const body = JSON.stringify({
          status: 'ok',
          instanceId: this.hubInstanceId,
          uptime: process.uptime(),
          agents: this.agentRegistry.totalCount(),
          sdks: this.sdkRegistry.totalCount(),
          memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }

      // ── Metrics ───────────────────────────────────────────────
      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`hub_agents_connected ${this.agentRegistry.totalCount()}`);
        return;
      }

      if (req.method === 'POST' && req.url === '/internal/proxy') {
        if (!this.checkInternalAuth(req)) {
          res.writeHead(this.config.internalSecret ? 401 : 503, {
            'Content-Type': 'application/json',
          });
          res.end(
            JSON.stringify({
              success: false,
              message: this.config.internalSecret
                ? 'Unauthorized'
                : 'Internal proxy endpoint is disabled (HUB_INTERNAL_SECRET not configured)',
            }),
          );
          return;
        }
        let rawBody = '';
        req.on('data', (chunk: Buffer) => {
          rawBody += chunk.toString();
        });
        req.on('end', () => {
          try {
            const input = JSON.parse(rawBody) as {
              agentId: string;
              method: string;
              path: string;
              headers: Record<string, string>;
              body: unknown;
            };

            const agent = this.agentRegistry.findByAgentId(input.agentId);
            if (!agent) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({ success: false, message: `Agent ${input.agentId} not connected` }),
              );
              return;
            }

            const requestId = `req_${crypto.randomUUID()}`;

            const timeout = setTimeout(() => {
              this.pendingRequests.delete(requestId);
              res.writeHead(504, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: 'Agent response timeout' }));
            }, 15000);

            this.pendingRequests.set(requestId, (response: unknown) => {
              clearTimeout(timeout);
              const r = response as { status: number; statusText: string; body: unknown };
              res.writeHead(r.status ?? 200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  success: true,
                  status: r.status,
                  statusText: r.statusText,
                  data: r.body,
                }),
              );
            });

            agent.ws.send(
              JSON.stringify({
                type: 'http_request',
                requestId,
                method: input.method,
                path: input.path,
                headers: input.headers,
                body: input.body,
              }),
            );
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid request body' }));
          }
        });
        return;
      }

      if (this.httpTunnelHandler.isTunnelRequest(req)) {
        await this.httpTunnelHandler.handle(req, res).catch((err: Error) => {
          console.error({ err: err.message }, '[hub] unhandled error in HTTP tunnel handler');
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal tunnel error', tunnel: true }));
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const wss = new WebSocketServer({
      noServer: true,
      // server,
      maxPayload: 100 * 1024 * 1024,
    });

    server.on('upgrade', (req, socket, head) => {
      const pathname = req.url;

      // Only handle WebSocket upgrades for known paths
      if (pathname === '/agent' || pathname === '/sdk') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          (ws as unknown as WebSocketWithMeta).meta = {
            connectedAt: Date.now(),
            ip: req.socket.remoteAddress,
            type: pathname === '/agent' ? 'agent' : 'sdk',
          };
          wss.emit('connection', ws, req);
        });
        return;
      }

      if (this.httpTunnelHandler.isTunnelRequest(req)) {
        this.httpTunnelHandler.handleWebSocket(req, socket as any, head).catch(() => {
          socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          socket.destroy();
        });
        return; // ← httpTunnelHandler creates its own wss internally, never touches the main wss
      }

      // Not /agent, /sdk or a tunnel host: nothing to upgrade.
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
    });

    wss.on('connection', (ws: WebSocketWithMeta) => {
      const { type, ip } = ws.meta;

      console.info({ type, ip }, '[hub] connected');

      ws.on('message', (message: Buffer) => {
        if (type === 'agent') {
          // this.router.routeAgentMessage(ws, message, ip).catch(console.error);
          this.router.routeAgentMessage(ws, message, ip ?? 'unknown').catch(console.error);
        } else {
          // this.router.routeSdkMessage(ws, message, ip).catch(console.error);
          this.router.routeSdkMessage(ws, message, ip ?? 'unknown').catch(console.error);
        }
      });

      ws.on('close', async () => {
        if (type === 'agent') {
          // Awaited so the close handler's own async work (subdomain
          // unregister, session-disconnect DB write) actually runs to
          // completion and any rejection surfaces here rather than as an
          // unhandled promise elsewhere. This does NOT eliminate the
          // documented register-vs-close race for a rapid reconnect on the
          // same label (context.md risk #23/#19) — that race is between two
          // independent WS connections/event-loop turns and isn't fixable
          // by awaiting inside a single handler. See decision.md,
          // 2026-09-12, "onAgentClose await".
          try {
            await this.router.onAgentClose(ws);
          } catch (err) {
            console.error({ err: (err as Error).message }, '[hub] error in onAgentClose');
          }
        } else {
          this.router.onSdkClose(ws);
        }
      });
    });

    return new Promise((resolve) => {
      server.listen(this.config.port, () => {
        console.info('[hub] ✅ WS server started (ws)');
        resolve();
      });
    });
    // });
  }

  async stop(): Promise<void> {
    this.heartbeat.stop();
    this.statusSweep.stop();
    // Flush any usage accumulated since the last 30s interval before
    // stopping — a graceful shutdown can afford this; a crash can't, and
    // that's an accepted, documented gap for this soft counter (see
    // PublicPathUsageLimiter's own header comment).
    this.publicPathUsageLimiter.flush();
    this.publicPathUsageLimiter.stop();
    await this.pubsub.stop();
    this.agentRegistry.evictAll();

    console.info('[hub] server stopped');
  }
}
