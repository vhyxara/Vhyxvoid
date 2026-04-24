// apps/hub/src/HubServer.ts
// uWebSockets.js server — maximum throughput (~1.2M msg/sec per core).
// Two WS endpoints: /agent (agent connections) and /sdk (frontend SDK connections).
// Health + metrics endpoints for load balancer probes.

// import uWS from 'uWebSockets.js';
import { Redis } from '@upstash/redis';
import { v4 as uuid } from 'uuid';
import { AgentRegistry } from '@/registry/Agent.registry';
import { SdkRegistry } from '@/registry/Sdk.registry';
import { PendingRegistry } from '@/registry/Pending.registry';
import { MessageRouter } from '@/router/Message.router';
import { HubAuthService } from '@/services/HubAuth.service';
import { HeartbeatService } from '@/services/Heartbeat.service';
import { HubUsageService } from '@/services/HubUsage.service';
import { HubPubSub } from '@/services/HubPubSub';
import { TunnelRequestRepository } from '@/repositories/TunnelRequest.repository';
import { IValidateApiKeyUseCase } from '@platform/shared';
import { TunnelSessionRepository } from '@/repositories/TunnelSession.repository';
// const uWS = require('uWebSockets.js');
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

// import uWS from 'uWebSockets.js';

type UWSWebSocket = any;
type UWSResponse = any;
type UWSRequest = any;

// Per-connection metadata stored in uWS user data slot
interface WsUserData {
  connectedAt: number;
  ip: string;
  type: 'agent' | 'sdk';
}

export interface HubServerConfig {
  port: number;
  hubInstanceId?: string;
  redis: Redis;
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
  private readonly usageService: HubUsageService;
  private readonly pubsub: HubPubSub;
  private readonly router: MessageRouter;
  private listenSocket: any = null;

  constructor(private readonly config: HubServerConfig) {
    this.hubInstanceId = config.hubInstanceId ?? `hub_${uuid().replace(/-/g, '').slice(0, 12)}`;

    // ── Registries ───────────────────────────────────────────────────────────
    this.agentRegistry = new AgentRegistry();
    this.sdkRegistry = new SdkRegistry();
    this.pendingRegistry = new PendingRegistry(config.redis);

    // ── Services ─────────────────────────────────────────────────────────────
    const authService = new HubAuthService(config.validateKeyUseCase);
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
    );
  }

  async start(): Promise<void> {
    // Clean up stale CONNECTED sessions from a previous crash of this hub instance
    await this.config.tunnelSessionRepo
      .evictStaleForInstance(this.hubInstanceId)
      .catch((err: Error) => console.warn('[hub] failed to evict stale sessions', err));

    await this.pubsub.start();
    this.heartbeat.start();

    // return new Promise((resolve, reject) => {
    //   ws
    //     .App()

    // ── Health check ───────────────────────────────────────────────────
    // .get('/health', (res: UWSResponse) => {
    //   const body = JSON.stringify({
    //     status: 'ok',
    //     instanceId: this.hubInstanceId,
    //     uptime: process.uptime(),
    //     agents: this.agentRegistry.totalCount(),
    //     sdks: this.sdkRegistry.totalCount(),
    //     pending: this.pendingRegistry.size(),
    //     memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    //   });
    //   res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json').end(body);
    // })

    // ── Prometheus metrics ─────────────────────────────────────────────
    // .get('/metrics', (res: UWSResponse) => {
    //   const lines = [
    //     `# HELP hub_agents_connected Number of currently connected agents`,
    //     `# TYPE hub_agents_connected gauge`,
    //     `hub_agents_connected ${this.agentRegistry.totalCount()}`,
    //     `# HELP hub_sdk_connected Number of currently connected SDK clients`,
    //     `# TYPE hub_sdk_connected gauge`,
    //     `hub_sdk_connected ${this.sdkRegistry.totalCount()}`,
    //     `# HELP hub_pending_requests Number of in-flight tunnel requests`,
    //     `# TYPE hub_pending_requests gauge`,
    //     `hub_pending_requests ${this.pendingRegistry.size()}`,
    //   ].join('\n');

    //   res
    //     .writeStatus('200 OK')
    //     .writeHeader('Content-Type', 'text/plain; version=0.0.4')
    //     .end(lines);
    // })
    const server = createServer((req, res) => {
      if (req.url === '/health') {
        const body = JSON.stringify({
          status: 'ok',
          instanceId: this.hubInstanceId,
          uptime: process.uptime(),
          agents: this.agentRegistry.totalCount(),
          sdks: this.sdkRegistry.totalCount(),
          pending: this.pendingRegistry.size(),
          memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }

      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`hub_agents_connected ${this.agentRegistry.totalCount()}`);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    // ── Agent WebSocket endpoint ───────────────────────────────────────
    // .ws('/agent', {
    //   compression: ws.SHARED_COMPRESSOR, // per-message deflate
    //   maxPayloadLength: 10 * 1024 * 1024, // 10MB
    //   idleTimeout: 120, // 2 min idle — heartbeat keeps alive
    //   sendPingsAutomatically: false, // we manage pings ourselves

    //   upgrade: (res: UWSResponse, req: UWSRequest, ctx: any) => {
    //     const ip = Buffer.from(res.getRemoteAddressAsText()).toString();
    //     res.upgrade(
    //       { connectedAt: Date.now(), ip, type: 'agent' },
    //       req.getHeader('sec-websocket-key'),
    //       req.getHeader('sec-websocket-protocol'),
    //       req.getHeader('sec-websocket-extensions'),
    //       ctx,
    //     );
    //   },

    //   open: (ws: UWSWebSocket) => {
    //     // const { ip } = ws.getUserData();
    //     const { ip } = ws.getUserData() as WsUserData;
    //     console.info({ ip }, '[hub] agent connected');
    //   },

    //   message: (ws: UWSWebSocket, message: ArrayBuffer) => {
    //     // const { ip } = ws.getUserData();
    //     const { ip } = ws.getUserData() as WsUserData;
    //     const data = Buffer.from(message);
    //     this.router
    //       .routeAgentMessage(ws as any, data, ip)
    //       .catch((err) => console.error({ err }, '[hub] agent message error'));
    //   },

    //   close: (ws: UWSWebSocket, code: number, message: ArrayBuffer) => {
    //     const reason = Buffer.from(message).toString();
    //     console.info({ code, reason }, '[hub] agent disconnected');
    //     this.router.onAgentClose(ws as any);
    //   },
    // })

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const pathname = req.url;

      if (pathname === '/agent' || pathname === '/sdk') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          (ws as any).meta = {
            connectedAt: Date.now(),
            ip: req.socket.remoteAddress,
            type: pathname === '/agent' ? 'agent' : 'sdk',
          };

          wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    wss.on('connection', (ws: any, req) => {
      const { type, ip } = ws.meta;

      console.info({ type, ip }, '[hub] connected');

      ws.on('message', (message: Buffer) => {
        if (type === 'agent') {
          this.router.routeAgentMessage(ws, message, ip).catch(console.error);
        } else {
          this.router.routeSdkMessage(ws, message, ip).catch(console.error);
        }
      });

      ws.on('close', () => {
        if (type === 'agent') this.router.onAgentClose(ws);
        else this.router.onSdkClose(ws);
      });
    });

    // ── SDK WebSocket endpoint ─────────────────────────────────────────
    // .ws('/sdk', {
    //   compression: ws.SHARED_COMPRESSOR,
    //   maxPayloadLength: 10 * 1024 * 1024,
    //   idleTimeout: 300, // 5 min — SDK connections are long-lived
    //   sendPingsAutomatically: false,

    //   upgrade: (res: any, req: any, ctx: any) => {
    //     const ip = Buffer.from(res.getRemoteAddressAsText()).toString();
    //     res.upgrade(
    //       { connectedAt: Date.now(), ip, type: 'sdk' },
    //       req.getHeader('sec-websocket-key'),
    //       req.getHeader('sec-websocket-protocol'),
    //       req.getHeader('sec-websocket-extensions'),
    //       ctx,
    //     );
    //   },

    //   open: (ws: UWSWebSocket) => {
    //     console.info({ ip: ws.getUserData().ip }, '[hub] sdk connected');
    //   },

    //   message: (ws: UWSWebSocket, message: ArrayBuffer) => {
    //     const { ip } = ws.getUserData();
    //     const data = Buffer.from(message);
    //     this.router
    //       .routeSdkMessage(ws as any, data, ip)
    //       .catch((err) => console.error({ err }, '[hub] sdk message error'));
    //   },

    //   close: (ws: any) => {
    //     this.router.onSdkClose(ws as any);
    //   },
    // })

    // .listen(this.config.port, (token: any) => {
    //   if (!token) {
    //     return reject(new Error(`Failed to listen on port ${this.config.port}`));
    //   }
    //   this.listenSocket = token;
    //   console.info(
    //     {
    //       port: this.config.port,
    //       instanceId: this.hubInstanceId,
    //     },
    //     '[hub] ✅ WebSocket server started',
    //   );
    //   resolve();
    // });

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
    await this.pubsub.stop();
    this.agentRegistry.evictAll();

    // if (this.listenSocket) {
    //   ws.us_listen_socket_close(this.listenSocket);
    //   this.listenSocket = null;
    // }

    console.info('[hub] server stopped');
  }
}
