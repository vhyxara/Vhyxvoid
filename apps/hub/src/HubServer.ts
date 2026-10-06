// apps/hub/src/HubServer.ts
// Node http + ws server. Two WS endpoints: /agent (agent connections) and
// /sdk (SDK TunnelClient connections); tunnel hosts are proxied to agents.
// /health and /metrics answer only on non-tunnel hosts.

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
import { createServer, type Server } from 'http';
import { WebSocketServer } from 'ws';
import { SubdomainRegistry } from './services/SubdomainRegistry.service';
import { HttpTunnelHandler } from './handlers/HttpTunnel.handler';
import WebSocket from 'ws';
import { isInternalRequestAuthorized } from './utils/internalAuth';
import { RequestInspectorService } from '@/services/RequestInspector.service';
import { replayInspectedRequest } from '@/services/Replay.service';
import type { InspectorRedisWriter } from '@vhyxvoid/shared';

/** Largest WS frame accepted once a socket is registered (10 MB body as base64 + JSON). */
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
/** Largest frame accepted before registration (a register message is tiny). */
const MAX_PREAUTH_FRAME_BYTES = 64 * 1024;
/** A socket that has not registered by then is closed (audit M7). */
const AUTH_DEADLINE_MS = 10_000;
/** Unregistered sockets allowed per remote address at once. */
const MAX_PENDING_PER_IP = 20;

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
  private readonly subdomainRegistry: SubdomainRegistry;
  private readonly httpTunnelHandler: HttpTunnelHandler;
  private httpServer: Server | null = null;
  private readonly pendingAuthByIp = new Map<string, number>();
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

    const subdomainRelease = {
      findAccountSlug: (accountId: string) => config.tunnelSessionRepo.findAccountSlug(accountId),
      unregister: (label: string, slug: string, agentId: string) =>
        this.subdomainRegistry.unregister(label, slug, agentId),
    };

    this.heartbeat = new HeartbeatService(
      this.agentRegistry,
      this.pendingRegistry,
      config.tunnelSessionRepo,
      config.redis,
      this.hubInstanceId,
      subdomainRelease,
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
      new RequestInspectorService(config.redis as unknown as InspectorRedisWriter, config.tunnelSessionRepo),
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
      subdomainRelease,
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
      // Tunnel hosts belong to tenants: their /health and /metrics are the
      // developer's own routes, never the hub's (audit M1).
      const isTunnel = this.httpTunnelHandler.isTunnelRequest(req);

      // ── Health check ──────────────────────────────────────────
      if (!isTunnel && req.url === '/health') {
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
      if (!isTunnel && req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(this.metricsText());
        return;
      }

      // ── Internal admin endpoints (apps/api only, shared secret) ──
      if (!isTunnel && req.url?.startsWith('/internal/')) {
        this.handleInternal(req, res);
        return;
      }

      if (isTunnel) {
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
      maxPayload: MAX_FRAME_BYTES,
    });

    server.on('upgrade', (req, socket, head) => {
      const pathname = req.url;

      // Only handle WebSocket upgrades for known paths
      if (pathname === '/agent' || pathname === '/sdk') {
        const ip = req.socket.remoteAddress ?? 'unknown';
        if ((this.pendingAuthByIp.get(ip) ?? 0) >= MAX_PENDING_PER_IP) {
          socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
          socket.destroy();
          return;
        }
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
      const ipKey = ip ?? 'unknown';
      const isRegistered = () =>
        type === 'agent' ? !!this.agentRegistry.findByWs(ws) : !!this.sdkRegistry.findByWs(ws);

      // Pre-auth accounting (audit M7): a cap per address, a deadline, and a
      // small frame limit until the socket has registered.
      this.pendingAuthByIp.set(ipKey, (this.pendingAuthByIp.get(ipKey) ?? 0) + 1);
      let pendingAuth = true;
      const leavePendingAuth = () => {
        if (!pendingAuth) return;
        pendingAuth = false;
        const left = (this.pendingAuthByIp.get(ipKey) ?? 1) - 1;
        if (left <= 0) this.pendingAuthByIp.delete(ipKey);
        else this.pendingAuthByIp.set(ipKey, left);
      };
      const authDeadline = setTimeout(() => {
        if (!isRegistered()) ws.close(4001, 'Registration timeout');
        leavePendingAuth();
      }, AUTH_DEADLINE_MS);
      authDeadline.unref?.();

      console.info({ type, ip }, '[hub] connected');

      ws.on('message', (message: Buffer) => {
        if (pendingAuth) {
          if (isRegistered()) {
            leavePendingAuth();
          } else if (message.length > MAX_PREAUTH_FRAME_BYTES) {
            ws.close(1009, 'Register first');
            return;
          }
        }
        if (type === 'agent') {
          // this.router.routeAgentMessage(ws, message, ip).catch(console.error);
          this.router.routeAgentMessage(ws, message, ip ?? 'unknown').catch(console.error);
        } else {
          // this.router.routeSdkMessage(ws, message, ip).catch(console.error);
          this.router.routeSdkMessage(ws, message, ip ?? 'unknown').catch(console.error);
        }
      });

      ws.on('close', async () => {
        clearTimeout(authDeadline);
        leavePendingAuth();
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

    this.httpServer = server;
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

    // Release this instance's routes and mark its sessions disconnected
    // BEFORE closing sockets (audit H7): evictAll() empties the registry
    // first, so the per-socket close handlers would find nothing to clean.
    await Promise.allSettled([
      this.subdomainRegistry.unregisterAllForHub(this.hubInstanceId),
      this.config.tunnelSessionRepo.evictStaleForInstance(this.hubInstanceId),
    ]);
    this.agentRegistry.evictAll();
    this.httpServer?.close();

    console.info('[hub] server stopped');
  }

  /** Instance id: stable across restarts so start-up cleanup finds the previous run's state. */
  get instanceId(): string {
    return this.hubInstanceId;
  }

  /** Live counters for the admin panel (served by apps/api through /internal/stats). */
  stats() {
    const mem = process.memoryUsage();
    return {
      instanceId: this.hubInstanceId,
      uptimeSeconds: Math.round(process.uptime()),
      agents: this.agentRegistry.totalCount(),
      sdks: this.sdkRegistry.totalCount(),
      pendingRequests: this.pendingRegistry.size(),
      tunnelWebSockets: this.httpTunnelHandler.webSocketCount(),
      pendingAuthSockets: [...this.pendingAuthByIp.values()].reduce((a, b) => a + b, 0),
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        rssMb: Math.round(mem.rss / 1048576),
      },
      nodeVersion: process.version,
    };
  }

  /** Every connected agent, for the admin panel's live tunnel view. */
  listAgents() {
    return this.agentRegistry.allSessions().map((s) => ({
      agentId: s.agentId,
      accountId: s.accountId,
      label: s.label,
      agentVersion: s.agentVersion,
      ip: s.ip,
      connectedAt: s.connectedAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      missedPings: s.missedPings,
      capabilities: s.capabilities ?? [],
    }));
  }

  /** Force-disconnect one agent (admin action). The agent stops and does not reconnect. */
  disconnectAgent(agentId: string, reason: string): boolean {
    const session = this.agentRegistry.findByAgentId(agentId);
    if (!session) return false;
    try {
      session.ws.send(
        JSON.stringify({ v: '1', type: 'hub:error', code: 'AUTH_FAILED', message: reason, fatal: true }),
      );
    } catch {
      // socket already gone
    }
    session.ws.close(4001, 'Disconnected by an administrator');
    return true;
  }

  /**
   * GET  /internal/stats                       live counters
   * GET  /internal/agents                      connected agents
   * POST /internal/agents/:agentId/disconnect  force-disconnect one agent
   * POST /internal/replay                      replay an inspected request {accountId, label, id}
   * Authorized by `x-hub-internal-secret` = HUB_INTERNAL_SECRET; fails closed.
   * nginx must not expose /internal/ publicly (see nginx.conf).
   */
  private handleInternal(req: import('http').IncomingMessage, res: import('http').ServerResponse): void {
    const send = (status: number, body: unknown) => {
      const json = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(json);
    };
    if (!isInternalRequestAuthorized(req.headers['x-hub-internal-secret'], process.env.HUB_INTERNAL_SECRET)) {
      return send(process.env.HUB_INTERNAL_SECRET ? 401 : 503, { error: 'Unauthorized' });
    }
    const url = new URL(req.url ?? '/', 'http://hub');
    if (req.method === 'GET' && url.pathname === '/internal/stats') return send(200, this.stats());
    if (req.method === 'GET' && url.pathname === '/internal/agents') {
      const accountId = url.searchParams.get('accountId');
      const agents = this.listAgents().filter((a) => !accountId || a.accountId === accountId);
      return send(200, { agents });
    }
    if (req.method === 'POST' && url.pathname === '/internal/replay') {
      readJsonBody(req)
        .then((body) =>
          replayInspectedRequest({
            redis: this.config.redis,
            hubPort: this.config.port,
            hubDomain: this.config.hubDomain,
            secret: process.env.HUB_INTERNAL_SECRET!,
            accountId: String(body.accountId ?? ''),
            label: String(body.label ?? ''),
            id: String(body.id ?? ''),
          }),
        )
        .then((r) => send(r.httpStatus, r.body))
        .catch((err) => send(500, { error: (err as Error).message }));
      return;
    }
    const m = url.pathname.match(/^\/internal\/agents\/([A-Za-z0-9_]+)\/disconnect$/);
    if (req.method === 'POST' && m) {
      const ok = this.disconnectAgent(m[1], 'This tunnel was disconnected by an administrator');
      return send(ok ? 200 : 404, { disconnected: ok });
    }
    return send(404, { error: 'Not found' });
  }

  private metricsText(): string {
    const s = this.stats();
    return [
      '# TYPE hub_agents_connected gauge',
      `hub_agents_connected ${s.agents}`,
      '# TYPE hub_sdk_sessions gauge',
      `hub_sdk_sessions ${s.sdks}`,
      '# TYPE hub_pending_requests gauge',
      `hub_pending_requests ${s.pendingRequests}`,
      '# TYPE hub_tunnel_websockets gauge',
      `hub_tunnel_websockets ${s.tunnelWebSockets}`,
      '# TYPE hub_heap_used_megabytes gauge',
      `hub_heap_used_megabytes ${s.memory.heapUsedMb}`,
      '',
    ].join('\n');
  }
}

/** A small JSON body (internal endpoints only). */
function readJsonBody(req: import('http').IncomingMessage, max = 16 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
