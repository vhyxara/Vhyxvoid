// apps/hub/src/router/MessageRouter.ts
// The core hub logic. Routes every WebSocket message to the correct handler.
// Stateless per-message — all state lives in registries.

import { v4 as uuid } from 'uuid';
import {
  parseMessage,
  serialize,
  ProtocolError,
  AgentRegisterMsg,
  AgentPongMsg,
  AgentBatchMsg,
  TunnelResponseMsg,
  TunnelAgentErrorMsg,
  SdkRegisterMsg,
  SdkRequestMsg,
  HubErrorMsg,
  SdkErrorMsg,
  SdkResponseMsg,
  HubRegisteredMsg,
  SdkRegisteredMsg,
  TunnelForwardMsg,
  TIMING,
  LIMITS,
  WS_CLOSE_CODES,
} from '@vhyxvoid/protocol';
// import { WebSocket } from 'uWebSockets.js';
// import { AgentRegistry, AgentSession, SdkRegistry, PendingRegistry } from '../registry';
// import {
//   HubAuthService,
//   HubAuthError,
//   HeartbeatService,
//   HubUsageService,
//   HubPubSub,
// } from '../services';
import { TunnelSessionRepository } from '@/repositories/TunnelSession.repository';
import { TunnelRequestRepository } from '@/repositories/TunnelRequest.repository';
import { PLAN_AGENT_LIMITS } from '@vhyxvoid/protocol';
import { HeartbeatService } from '@/services/Heartbeat.service';
import { HubAuthService, HubAuthError } from '@/services/HubAuth.service';
import { HubPubSub } from '@/services/HubPubSub';
import { HubUsageService } from '@/services/HubUsage.service';
import { AgentRegistry, AgentSession } from '@/registry/Agent.registry';
import { PendingRegistry } from '@/registry/Pending.registry';
import { SdkRegistry } from '@/registry/Sdk.registry';

export class MessageRouter {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly sdkRegistry: SdkRegistry,
    private readonly pendingRegistry: PendingRegistry,
    private readonly authService: HubAuthService,
    private readonly heartbeat: HeartbeatService,
    private readonly usageService: HubUsageService,
    private readonly pubsub: HubPubSub,
    private readonly sessionRepo: TunnelSessionRepository,
    private readonly requestRepo: TunnelRequestRepository,
    private readonly hubInstanceId: string,
  ) {}

  // ── Agent message routing ──────────────────────────────────────────────────

  async routeAgentMessage(ws: any, data: Buffer | string, ip: string): Promise<void> {
    let msg: ReturnType<typeof parseMessage>;
    try {
      msg = parseMessage(data);
    } catch (err) {
      if (err instanceof ProtocolError) {
        return this.sendToWs(ws, this.buildHubError(err.code, err.message, undefined, false));
      }
      return this.sendToWs(
        ws,
        this.buildHubError('INVALID_MESSAGE', 'Malformed message', undefined, false),
      );
    }

    try {
      switch (msg.type) {
        case 'agent:register':
          return await this.handleAgentRegister(ws, msg as AgentRegisterMsg, ip);
        case 'agent:pong':
          return this.handleAgentPong(msg as AgentPongMsg);
        case 'agent:batch':
          return this.handleAgentBatch(ws, msg as AgentBatchMsg);
        case 'tunnel:response':
          return this.handleTunnelResponse(msg as TunnelResponseMsg);
        case 'tunnel:agent-error':
          return this.handleTunnelAgentError(msg as TunnelAgentErrorMsg);
        default:
          return this.sendToWs(
            ws,
            this.buildHubError(
              'INVALID_MESSAGE',
              `Unknown message type: ${(msg as any).type}`,
              undefined,
              false,
            ),
          );
      }
    } catch (err) {
      console.error(
        { err: err instanceof Error ? err.message : String(err), type: msg.type },
        '[router] unhandled error in agent message',
      );
      this.sendToWs(ws, this.buildHubError('INTERNAL_ERROR', 'Internal error', undefined, false));
    }
  }

  // ── SDK message routing ────────────────────────────────────────────────────

  async routeSdkMessage(ws: any, data: Buffer | string, ip: string): Promise<void> {
    let msg: ReturnType<typeof parseMessage>;
    try {
      msg = parseMessage(data);
    } catch (err) {
      if (err instanceof ProtocolError) {
        return this.sendToWs(
          ws,
          this.buildSdkError('INVALID_MESSAGE', err.message, undefined, false),
        );
      }
      return this.sendToWs(
        ws,
        this.buildSdkError('INVALID_MESSAGE', 'Malformed message', undefined, false),
      );
    }

    try {
      switch (msg.type) {
        case 'sdk:register':
          return await this.handleSdkRegister(ws, msg as SdkRegisterMsg, ip);
        case 'sdk:request':
          return await this.handleSdkRequest(ws, msg as SdkRequestMsg, ip);
        default:
          return this.sendToWs(
            ws,
            this.buildSdkError(
              'INVALID_MESSAGE',
              `Unknown type: ${(msg as any).type}`,
              undefined,
              false,
            ),
          );
      }
    } catch (err) {
      console.error(
        { err: err instanceof Error ? err.message : String(err), type: msg.type },
        '[router] unhandled error in sdk message',
      );
      this.sendToWs(ws, this.buildSdkError('INTERNAL_ERROR', 'Internal error', undefined, false));
    }
  }

  // ── Connection close handlers ──────────────────────────────────────────────

  onAgentClose(ws: any): void {
    const session = this.agentRegistry.findByWs(ws);
    if (!session) return;

    this.agentRegistry.evict(session.accountId, session.label);

    const rejected = this.pendingRegistry.rejectAllForAgent(session.accountId, session.label);

    this.sessionRepo.markDisconnected(session.agentId, 'DISCONNECTED').catch(() => {});

    console.info(
      {
        agentId: session.agentId,
        accountId: session.accountId,
        label: session.label,
        rejected,
      },
      '[router] agent disconnected',
    );
  }

  onSdkClose(ws: any): void {
    this.sdkRegistry.evictByWs(ws);
  }

  // ── Agent handlers ─────────────────────────────────────────────────────────

  private async handleAgentRegister(ws: any, msg: AgentRegisterMsg, ip: string): Promise<void> {
    // 1. Authenticate
    let auth: Awaited<ReturnType<HubAuthService['authenticateAgent']>>;
    try {
      auth = await this.authService.authenticateAgent(msg, ip);
    } catch (err) {
      if (err instanceof HubAuthError) {
        this.sendToWs(ws, this.buildHubError(err.code as any, err.message, undefined, true));
        ws.close();
        return;
      }
      throw err;
    }

    // 2. Plan limit check
    const agentCount = this.agentRegistry.countByAccount(auth.accountId);
    const limit = PLAN_AGENT_LIMITS.PRO; // TODO: resolve from plan service
    if (agentCount >= limit) {
      this.sendToWs(
        ws,
        this.buildHubError(
          'AGENT_LIMIT_REACHED',
          `Maximum ${limit} agents allowed on your plan`,
          undefined,
          true,
        ),
      );
      ws.close();
      return;
    }

    // ── Resolve internal apiKey UUID from public keyId ──────────────────────
    // auth.keyId is the public vhyxvoid_live_xxx — look up internal UUID + accountId
    // This is the ONLY place in the hub that does this lookup
    // All downstream code uses the internal UUID
    const apiKey = await this.sessionRepo.findApiKeyByPublicId(auth.keyId);
    if (!apiKey) {
      console.error(
        { publicKeyId: auth.keyId },
        '[router] API key not found by public ID — cannot register agent',
      );
      this.sendToWs(ws, this.buildHubError('AUTH_FAILED', 'API key not found', undefined, true));
      ws.close();
      return;
    }

    // 3. Register in AgentRegistry
    const agentId = `agt_${uuid().replace(/-/g, '')}`;
    const session: AgentSession = {
      agentId,
      accountId: apiKey.accountId, // ← from DB, never from client
      keyId: apiKey.id, // ← internal UUID
      label: msg.label,
      ws,
      connectedAt: new Date(),
      lastSeenAt: new Date(),
      missedPings: 0,
      agentVersion: msg.agentVersion,
      ip,
    };
    this.agentRegistry.register(session);

    // 4. Redis presence key (for cross-hub routing lookup)
    // hub:agent:{accountId}:{label} → hubInstanceId
    // Other hubs check this to know where to route
    // Fire and forget — registration succeeds regardless
    // import('@upstash/redis').then(({ Redis }) => {}).catch(() => {});
    // (Redis available via injected instance in HubServer)

    // 5. Send registered response immediately — don't wait for DB
    //    Agent needs this to start accepting forwarded requests
    const registered: HubRegisteredMsg = {
      v: '1',
      type: 'hub:registered',
      agentId,
      accountId: apiKey.accountId,
      replayPending: false,
    };
    this.sendToWs(ws, registered);

    console.info(
      { agentId, accountId: apiKey.accountId, label: msg.label },
      '[router] agent registered',
    );

    // 5. Persist TunnelSession to Postgres
    await this.sessionRepo
      .upsert({
        agentId,
        accountId: apiKey.accountId,
        apiKeyId: apiKey.id,
        label: msg.label,
        status: 'CONNECTED',
        hubInstanceId: this.hubInstanceId,
        metadata: { agentVersion: msg.agentVersion, ip },
      })
      .then(() => {
        console.info({ agentId }, '[router] session persisted to DB');
      })
      .catch((err) => {
        // Log clearly — don't crash the agent connection
        console.error(
          {
            err: err.message,
            agentId,
            accountId: apiKey.accountId,
            apiKeyId: apiKey.id,
            label: msg.label,
          },
          '[router] ❌ session upsert failed — agent works but dashboard will not show it',
        );
      }); // DB failure must not block registration

    // 6. Respond
    // const registered: HubRegisteredMsg = {
    //   v: '1',
    //   type: 'hub:registered',
    //   agentId,
    //   accountId: auth.accountId,
    //   replayPending: false,
    // };
    // this.sendToWs(ws, registered);

    // console.info(
    //   { agentId, accountId: auth.accountId, label: msg.label },
    //   '[router] agent registered',
    // );
  }

  private handleAgentPong(msg: AgentPongMsg): void {
    this.heartbeat.handlePong(msg.agentId);
  }

  private handleAgentBatch(ws: any, msg: AgentBatchMsg): void {
    for (const item of msg.messages) {
      try {
        switch (item.type) {
          case 'tunnel:response':
            this.handleTunnelResponse(item);
            break;
          case 'tunnel:agent-error':
            this.handleTunnelAgentError(item);
            break;
          case 'agent:pong':
            this.handleAgentPong(item);
            break;
        }
      } catch (err) {
        // console.error({ err, type: item.type }, '[router] error in batch item');
        console.error(
          { err: err instanceof Error ? err.message : String(err), type: msg.type },
          '[router] error in batch item',
        );
      }
    }
  }

  private handleTunnelResponse(msg: TunnelResponseMsg): void {
    const resolved = this.pendingRegistry.resolve(msg.requestId, msg);
    if (!resolved) {
      // Already timed out — log but don't error
      console.warn({ requestId: msg.requestId }, '[router] response for unknown/timed-out request');
      return;
    }

    // Async audit record — fire and forget
    this.requestRepo
      .recordResponse(msg.requestId, {
        status: msg.status,
        durationMs: msg.durationMs,
      })
      .catch(() => {});
  }

  private handleTunnelAgentError(msg: TunnelAgentErrorMsg): void {
    const rejected = this.pendingRegistry.reject(msg.requestId, msg.code, msg.message);
    if (!rejected) {
      console.warn({ requestId: msg.requestId }, '[router] agent error for unknown request');
    }

    this.requestRepo
      .recordResponse(msg.requestId, {
        status: null,
        errorCode: msg.code,
      })
      .catch(() => {});
  }

  // ── SDK handlers ───────────────────────────────────────────────────────────

  private async handleSdkRegister(ws: any, msg: SdkRegisterMsg, ip: string): Promise<void> {
    let auth: Awaited<ReturnType<HubAuthService['authenticateSdkRegister']>>;
    try {
      auth = await this.authService.authenticateSdkRegister(msg, ip);
    } catch (err) {
      if (err instanceof HubAuthError) {
        this.sendToWs(ws, this.buildSdkError(err.code as any, err.message, msg.requestId, false));
        ws.close();
        return;
      }
      throw err;
    }

    const sessionId = `sdk_${uuid().replace(/-/g, '')}`;
    this.sdkRegistry.register({
      sessionId,
      accountId: auth.accountId,
      keyId: auth.keyId,
      ws,
      connectedAt: new Date(),
    });

    const response: SdkRegisteredMsg = { v: '1', type: 'sdk:registered', sessionId };
    this.sendToWs(ws, response);
  }

  // private async handleSdkRequest(ws: any, msg: SdkRequestMsg, ip: string): Promise<void> {
  //   // 1. Authenticate (Redis cache hit = ~1ms)
  //   let auth: Awaited<ReturnType<HubAuthService['authenticateRequest']>>;
  //   try {
  //     auth = await this.authService.authenticateRequest(msg, ip);
  //   } catch (err) {
  //     if (err instanceof HubAuthError) {
  //       return this.sendToWs(
  //         ws,
  //         this.buildSdkError(err.code as any, err.message, msg.requestId, false),
  //       );
  //     }
  //     throw err;
  //   }

  //   // 2. Payload size check
  //   const bodyBytes = msg.body ? Buffer.byteLength(msg.body, 'utf8') : 0;
  //   if (bodyBytes > LIMITS.MAX_PAYLOAD_BYTES) {
  //     return this.sendToWs(
  //       ws,
  //       this.buildSdkError(
  //         'PAYLOAD_TOO_LARGE',
  //         `Payload ${bodyBytes} bytes exceeds limit of ${LIMITS.MAX_PAYLOAD_BYTES} bytes`,
  //         msg.requestId,
  //         false,
  //       ),
  //     );
  //   }

  //   // 3. Find agent
  //   // Phase 2: check cross-hub via Redis if not found locally
  //   const agent = this.agentRegistry.find(auth.accountId, msg.label);
  //   if (!agent) {
  //     return this.sendToWs(
  //       ws,
  //       this.buildSdkError(
  //         'AGENT_NOT_FOUND',
  //         msg.label
  //           ? `No agent with label "${msg.label}" is connected for your account`
  //           : 'No agent is connected for your account. Run: npx @vhyxvoid/agent --key YOUR_KEY --port YOUR_PORT',
  //         msg.requestId,
  //         false,
  //       ),
  //     );
  //   }

  //   // 4. Enqueue in PendingRegistry
  //   // The resolve/reject callbacks send the response back to the SDK's WebSocket
  //   await this.pendingRegistry.enqueue({
  //     requestId: msg.requestId,
  //     accountId: auth.accountId,
  //     agentLabel: agent.label,
  //     keyId: auth.keyId,
  //     enqueuedAt: Date.now(),
  //     resolve: (response: TunnelResponseMsg) => {
  //       const sdkResponse: SdkResponseMsg = {
  //         v: '1',
  //         type: 'sdk:response',
  //         requestId: msg.requestId,
  //         status: response.status,
  //         headers: response.headers,
  //         body: response.body,
  //         durationMs: response.durationMs,
  //       };
  //       this.sendToWs(ws, sdkResponse);
  //     },
  //     reject: (code, message) => {
  //       this.sendToWs(ws, this.buildSdkError(code, message, msg.requestId, this.isRetryable(code)));
  //     },
  //     timer: setTimeout(() => {
  //       this.pendingRegistry.reject(
  //         msg.requestId,
  //         'AGENT_TIMEOUT',
  //         'Request timed out waiting for agent response',
  //       );
  //     }, TIMING.REQUEST_TIMEOUT_MS),
  //   });

  //   // 5. Forward to agent
  //   const forward: TunnelForwardMsg = {
  //     v: '1',
  //     type: 'tunnel:forward',
  //     requestId: msg.requestId,
  //     method: msg.method,
  //     path: msg.path,
  //     query: msg.query,
  //     headers: msg.headers,
  //     body: msg.body,
  //     timeoutMs: TIMING.REQUEST_TIMEOUT_MS - 2000, // 2s buffer for agent to respond
  //   };
  //   this.sendToWs(agent.ws, forward);

  //   // 6. Record usage (fire and forget)
  //   this.usageService.increment(auth.accountId, auth.keyId, 'requests', 1);

  //   // 7. Audit record (fire and forget)
  //   this.requestRepo
  //     .create({
  //       accountId: auth.accountId,
  //       apiKeyId: auth.keyId,
  //       sessionId: agent.agentId,
  //       requestId: msg.requestId,
  //       method: msg.method,
  //       path: msg.path,
  //     })
  //     .catch(() => {});
  // }

  // ── Helpers ────────────────────────────────────────────────────────────────

  // apps/hub/src/router/MessageRouter.ts
  // ONLY the handleSdkRequest method needs changing.
  // Replace your current handleSdkRequest with this version.
  // Everything else in MessageRouter stays identical.
  //
  // ROOT CAUSE OF FK VIOLATION:
  //   auth.keyId = 'vhyxvoid_live_d67d325...' (public keyId from JWT/cache)
  //   TunnelRequest.apiKeyId FK → ApiKey.id (internal UUID 'a906bf51-...')
  //   Passing public keyId as apiKeyId = FK violation.
  //
  // FIX:
  //   The AgentSession already has the resolved internal keyId (set in handleAgentRegister).
  //   Use agent.keyId (internal UUID) not auth.keyId (public string).
  //   Same for accountId — use agent.accountId which is verified from DB.

  private async handleSdkRequest(ws: any, msg: SdkRequestMsg, ip: string): Promise<void> {
    // 1. Authenticate
    let auth: Awaited<ReturnType<HubAuthService['authenticateRequest']>>;
    try {
      auth = await this.authService.authenticateRequest(msg, ip);
    } catch (err) {
      if (err instanceof HubAuthError) {
        return this.sendToWs(
          ws,
          this.buildSdkError(err.code as any, err.message, msg.requestId, false),
        );
      }
      throw err;
    }

    // 2. Payload size check
    const bodyBytes = msg.body ? Buffer.byteLength(msg.body, 'utf8') : 0;
    if (bodyBytes > LIMITS.MAX_PAYLOAD_BYTES) {
      return this.sendToWs(
        ws,
        this.buildSdkError(
          'PAYLOAD_TOO_LARGE',
          `Payload ${bodyBytes} bytes exceeds ${LIMITS.MAX_PAYLOAD_BYTES} byte limit`,
          msg.requestId,
          false,
        ),
      );
    }

    // 3. Find agent (by accountId from auth + optional label from message)
    const agent = this.agentRegistry.find(auth.accountId, msg.label);
    if (!agent) {
      return this.sendToWs(
        ws,
        this.buildSdkError(
          'AGENT_NOT_FOUND',
          msg.label
            ? `No agent with label "${msg.label}" is connected for your account`
            : 'No agent connected. Run: npx @vhyxvoid/agent --key YOUR_KEY --port YOUR_PORT',
          msg.requestId,
          false,
        ),
      );
    }

    // 4. Enqueue pending request
    await this.pendingRegistry.enqueue({
      requestId: msg.requestId,
      accountId: auth.accountId,
      agentLabel: agent.label,
      keyId: auth.keyId,
      enqueuedAt: Date.now(),
      resolve: (response: TunnelResponseMsg) => {
        const sdkResponse: SdkResponseMsg = {
          v: '1',
          type: 'sdk:response',
          requestId: msg.requestId,
          status: response.status,
          headers: response.headers,
          body: response.body,
          durationMs: response.durationMs,
        };
        this.sendToWs(ws, sdkResponse);
      },
      reject: (code, message) => {
        this.sendToWs(ws, this.buildSdkError(code, message, msg.requestId, this.isRetryable(code)));
      },
      timer: setTimeout(() => {
        this.pendingRegistry.reject(
          msg.requestId,
          'AGENT_TIMEOUT',
          'Request timed out waiting for agent response',
        );
      }, TIMING.REQUEST_TIMEOUT_MS),
    });

    // 5. Forward to agent
    const forward: TunnelForwardMsg = {
      v: '1',
      type: 'tunnel:forward',
      requestId: msg.requestId,
      method: msg.method,
      path: msg.path,
      query: msg.query,
      headers: msg.headers,
      body: msg.body,
      timeoutMs: TIMING.REQUEST_TIMEOUT_MS - 2000,
    };
    this.sendToWs(agent.ws, forward);

    // 6. Usage counter — fire and forget
    // auth.keyId = public keyId string — fine for Redis counter (not a FK)
    this.usageService.increment(auth.accountId, auth.keyId, 'requests', 1);

    // 7. Audit record — fire and forget
    // FIX: Use agent.keyId (internal UUID) not auth.keyId (public string)
    //      agent.keyId was resolved from public → internal in handleAgentRegister()
    //      agent.accountId is the verified accountId from DB (not from JWT)
    //      agent.agentId is the hub-assigned agt_xxx for session lookup
    this.requestRepo
      .create({
        accountId: agent.accountId, // ← from DB-verified AgentSession
        apiKeyId: agent.keyId, // ← internal UUID (NOT auth.keyId which is public)
        sessionId: agent.agentId, // ← agt_xxx — repo will resolve to TunnelSession.id
        requestId: msg.requestId,
        method: msg.method,
        path: msg.path,
      })
      .catch(() => {}); // fire and forget — never block the tunnel
  }

  private sendToWs(ws: any, msg: object): void {
    try {
      ws.send(serialize(msg as any));
    } catch {
      // WS already closed — ignore
    }
  }

  private buildHubError(
    code: string,
    message: string,
    requestId?: string,
    fatal: boolean = false,
  ): HubErrorMsg {
    return { v: '1', type: 'hub:error', code: code as any, message, requestId, fatal };
  }

  private buildSdkError(
    code: string,
    message: string,
    requestId?: string,
    retryable: boolean = false,
  ): SdkErrorMsg {
    return {
      v: '1',
      type: 'sdk:error',
      code: code as any,
      message,
      requestId: requestId ?? '',
      retryable,
    };
  }

  private isRetryable(code: string): boolean {
    // These errors might succeed on retry — agent reconnecting, transient timeout
    return ['AGENT_DISCONNECTED', 'AGENT_TIMEOUT'].includes(code);
  }
}
