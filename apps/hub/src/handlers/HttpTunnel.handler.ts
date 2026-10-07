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

import type { RequestInspectorService } from '@/services/RequestInspector.service';
import type { TunnelPolicyCache } from '@/services/TunnelPolicyCache.service';
import type { InboxService } from '@/services/Inbox.service';
import type { TrafficStatsService } from '@/services/TrafficStats.service';
import {
  ACCESS_COOKIE,
  HUB_ERROR_HEADER,
  INBOX_ACK_STATUS,
  INBOX_BODY_MAX_BYTES,
  INBOX_DELIVERY_HEADER,
  inboxStoredHeaders,
  isInboxMethod,
  captureBody,
  evaluateTunnelAccess,
  PasswordGuessLimiter,
  INSPECT_BODY_MAX_BYTES,
  isBinaryForInspector,
  maskHeaders,
  stripAccessCookie,
  type AccessDecision,
  type InspectedRequest,
  evaluateTrafficRules,
  applyResponseHeaders,
  type TrafficPlan,
  mockHandles,
  resolveMock,
  resourceHandles,
  resolveResource,
  MemoryResourceStore,
  type MockApiDefinition,
  type MockResourceStore,
} from '@vhyxvoid/shared';
import type { TrafficRuleCache } from '@/services/TrafficRuleCache.service';
import type { CachedMock, MockApiCache } from '@/services/MockApiCache.service';
import { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, timingSafeEqual } from 'crypto';
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
// Unsent streamed bytes allowed per caller before the stream is cut.
const MAX_STREAM_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * The request's hostname: port removed, lowercased (browsers lowercase hosts,
 * other clients may not) and a trailing FQDN dot dropped (audit L8).
 */
export function requestHostname(req: IncomingMessage): string {
  const host = (req.headers.host ?? '').trim().toLowerCase();
  const withoutPort = host.startsWith('[') ? host : host.split(':')[0];
  return withoutPort.endsWith('.') ? withoutPort.slice(0, -1) : withoutPort;
}

/** Which tunnel a request is for when the hostname does not say (custom domains). */
export interface TunnelRoute {
  label: string;
  accountSlug: string;
}

/** The caller's address as nginx saw it (X-Real-IP), else the TCP peer. */
function clientIp(req: IncomingMessage): string | null {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  return req.socket?.remoteAddress ?? null;
}

/** What a public caller is told when the agent could not produce a response. */
export function publicAgentErrorMessage(code: string): string {
  switch (code) {
    case 'AGENT_TIMEOUT':
      return 'The service behind this tunnel did not respond in time.';
    case 'AGENT_DISCONNECTED':
      return 'The tunnel agent disconnected while handling this request. Try again.';
    case 'SEND_FAILED':
      return 'The request could not be delivered to the tunnel agent. Try again.';
    default:
      return 'The service behind this tunnel is not reachable right now.';
  }
}

/** The parts of a request a mock matches on before its body is read. */
function mockRequestHead(req: IncomingMessage) {
  return { method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers };
}

/** Whether a mock's endpoints or resources answer this request (endpoints win). */
function mockAnswers(def: MockApiDefinition, head: ReturnType<typeof mockRequestHead>): boolean {
  return mockHandles(def, head) || resourceHandles(def, head);
}

/** Marks load-test traffic sent by the API (with x-vhyxvoid-internal). */
export const LOAD_TEST_HEADER = 'x-vhyxvoid-load-test';

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
    // Request inspector capture; absent (tests, older wiring) means none.
    private readonly inspector?: RequestInspectorService,
    // Access rules (password / IP allowlist / share links); absent means none.
    private readonly policies?: TunnelPolicyCache,
    private readonly pepper: string = process.env.SERVER_HMAC_PEPPER ?? '',
    // Webhook inbox for offline tunnels; absent means none.
    private readonly inbox?: InboxService,
    // Per-minute traffic stats (alerts, charts); absent means none.
    private readonly stats?: TrafficStatsService,
    // Traffic rules (mocks, injected errors and delays, rewrites, headers); absent means none.
    private readonly rules?: TrafficRuleCache,
    // Wrong tunnel passwords per (account, tunnel, IP); 429 past the limit.
    private readonly passwordGuesses: PasswordGuessLimiter = new PasswordGuessLimiter(),
    // Hosted mock APIs per label; absent means none.
    private readonly mocks?: MockApiCache,
    // Data of mock resources (Redis at runtime; memory when absent, for tests).
    private readonly mockStore: MockResourceStore = new MemoryResourceStore(),
  ) {}

  /**
   * Returns true if this request is a tunnel subdomain request.
   * Returns false if it should fall through to other handlers (health, metrics etc).
   */
  isTunnelRequest(req: IncomingMessage): boolean {
    const hostname = requestHostname(req);
    // NOTE: called on EVERY incoming HTTP request — must stay gated, not just
    // "debug-labeled", or it floods logs at real traffic volume.
    debugLog('[tunnel] isTunnelRequest check:', hostname, 'domain:', this.hubDomain);

    // Must end with our domain and have at least one subdomain segment
    if (!hostname.endsWith(`.${this.hubDomain}`)) return false;
    // Exclude the apex domain itself
    if (hostname === this.hubDomain) return false;
    // A tunnel host is always `<slug>--<label>`; service hosts such as hub.
    // and api. never contain "--" and keep the hub's own routes (/health).
    return hostname.slice(0, -(this.hubDomain.length + 1)).includes('--');
  }

  /**
   * Handle a tunnel HTTP request end-to-end.
   * Writes the response directly to res.
   */
  /**
   * @param route set for a verified custom domain (resolved by the caller);
   *   absent means the tunnel is named by the `<slug>--<label>` hostname.
   */
  async handle(req: IncomingMessage, res: ServerResponse, route?: TunnelRoute): Promise<void> {
    const hostname = requestHostname(req);
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
    const parsed = route ?? this.parseSubdomain(hostname.slice(0, -(this.hubDomain.length + 1)));

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
      // Nothing registered for this URL: an "offline" rule may still answer,
      // then the label's mock API, then the inbox.
      if (await this.tryOfflineRules(req, res, label, accountSlug, hostname)) return;
      const offlineMock = await this.offlineMock(label, accountSlug);
      if (offlineMock && mockAnswers(offlineMock.mock.def, mockRequestHead(req))) {
        await this.answerOfflineMock(req, res, offlineMock, { label, accountSlug, hostname });
        return;
      }
      if (await this.tryInbox(req, res, null, label, accountSlug)) return;
      if (offlineMock) {
        // The label is a mock API, but nothing in it matches: say which route is missing.
        const access = await this.checkAccess(offlineMock.accountId, label, req);
        if (!access.allow) return this.sendAccessDenied(res, access, label);
        // Counted: traffic to routes the mock lacks is what analytics' spec drift reports.
        this.stats?.record(offlineMock.accountId, label, 404, 0, req.method ?? 'GET', req.url ?? '/');
        return this.sendError(
          res,
          404,
          `No mock endpoint matches ${req.method ?? 'GET'} ${(req.url ?? '/').split('?')[0]}. Add it to the mock API "${label}", or start the agent with label "${label}".`,
          { code: 'MOCK_NO_ROUTE' },
        );
      }
      return this.sendError(
        res,
        404,
        [
          `No active tunnel found for "${hostname}".`,
          `If this is your tunnel, start the agent with label "${label}".`,
        ].join(' '),
        { code: 'TUNNEL_OFFLINE' },
      );
    }

    // Per-account abuse limit on the public path — checked before the agent
    // lookup so a flood aimed at a URL with no agent connected is still
    // capped, not just one with a live agent behind it. See
    // shared/decision.md, 2026-09-22, "S5 investigation and proposal".
    if (this.usageLimiter && !this.isLoadTest(req)) {
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

    // Access rules: checked after the abuse limiter (a password-guessing
    // flood is still capped) and before anything reaches the agent.
    const access = await this.checkAccess(entry.accountId, label, req);
    if (!access.allow) return this.sendAccessDenied(res, access, label);

    // Get the agent's live WebSocket connection
    const agent = this.agentRegistry.findByAgentId(entry.agentId);

    // Traffic rules: after the limiter and access rules (a mock never opens a
    // protected tunnel), before anything reaches the agent. "Offline" rules
    // take part only when no agent is connected.
    const plan = await this.trafficPlan(entry.accountId, label, req, !!agent);
    if (plan.respond) {
      this.usageLimiter?.recordForwarded(entry.accountId);
      await this.answerFromRule(req, res, plan, { accountId: entry.accountId, label, accountSlug, hostname });
      return;
    }

    // Hosted mock API on this label: "ALWAYS" answers the routes it has even
    // with an agent connected (the rest go to the agent); "OFFLINE" only
    // while the agent is away. Traffic rules' delay and header changes apply.
    const mock = this.mocks ? await this.mocks.get(entry.accountId, label) : null;
    if (mock && (mock.def.mode === 'ALWAYS' || !agent) && mockAnswers(mock.def, mockRequestHead(req))) {
      this.usageLimiter?.recordForwarded(entry.accountId);
      await this.answerFromMock(req, res, mock, { accountId: entry.accountId, label, accountSlug, hostname }, plan);
      return;
    }

    if (!agent) {
      // Entry in Redis but agent not in registry — stale, clean it up.
      // Passing entry.agentId makes this a compare-and-delete (see
      // SubdomainRegistry.unregister) — if a real reconnect races this
      // cleanup and re-registers the label first, this becomes a correct
      // no-op instead of deleting the fresh, valid entry.
      await this.subdomainRegistry.unregister(label, accountSlug, entry.agentId);
      if (await this.tryInbox(req, res, entry.accountId, label, accountSlug, access)) return;
      return this.sendError(
        res,
        503,
        [
          'Tunnel is registered but agent is not connected.',
          'The agent may have disconnected. Please restart it.',
        ].join(' '),
        { code: 'TUNNEL_OFFLINE' },
      );
    }

    // Counted only now that a live agent will get it (hub backlog,
    // 2026-09-24: a stale entry's 503s used to count as usage).
    this.usageLimiter?.recordForwarded(entry.accountId);

    // Read request body
    const startedAt = Date.now();
    let requestBody: Buffer | null = null;
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
      let rawBuffer: Buffer;
      try {
        rawBuffer = await this.readBody(req, MAX_BODY_BYTES);
      } catch {
        // A chunked body over the cap, or the caller hung up mid-upload
        // (audit M14: this used to surface as a 500).
        if (res.headersSent || res.destroyed) return;
        return this.sendError(
          res,
          413,
          `Request body too large. Maximum is ${MAX_BODY_BYTES / 1024 / 1024}MB`,
        );
      }
      requestBody = rawBuffer;
      if (rawBuffer.length > 0) {
        bodyEncoding = isBinaryContentType(req.headers['content-type']) ? 'base64' : 'utf8';
        body = rawBuffer.toString(bodyEncoding);
      }
    }

    // Injected latency from a "delay" rule, before the agent sees the request.
    if (plan.delayMs > 0) {
      await new Promise((r) => setTimeout(r, plan.delayMs));
      if (res.destroyed) return;
    }

    // How long to wait for the agent to respond before returning 504
    const requestTimeoutMs = getTunnelRequestTimeoutMs();

    // Build forward message
    const requestId = `req_${randomUUID().replace(/-/g, '')}`;

    // A replay from the dashboard comes back through this same path from the
    // hub itself, marked with the internal secret; anyone else's markers are
    // ignored. Both headers are stripped before forwarding.
    const replayOf = this.replayMarker(req);

    // Strip hop-by-hop headers before forwarding
    const forwardHeaders = this.sanitizeHeaders(req.headers as Record<string, string>);
    delete forwardHeaders['x-vhyxvoid-internal'];
    delete forwardHeaders['x-vhyxvoid-replay-of'];
    delete forwardHeaders[LOAD_TEST_HEADER];
    delete forwardHeaders[INBOX_DELIVERY_HEADER];
    // The tunnel's own credentials are not the app's: don't forward them.
    this.withoutTunnelCredentials(forwardHeaders, access.stripAuthorization);
    // Request header changes from traffic rules (validated: never framing or Host).
    for (const name of plan.removeRequestHeaders) {
      for (const k of Object.keys(forwardHeaders)) if (k.toLowerCase() === name) delete forwardHeaders[k];
    }
    for (const [name, value] of Object.entries(plan.setRequestHeaders)) {
      for (const k of Object.keys(forwardHeaders)) if (k.toLowerCase() === name) delete forwardHeaders[k];
      forwardHeaders[name] = value;
    }
    const hasResponseRules = plan.removeResponseHeaders.length > 0 || Object.keys(plan.setResponseHeaders).length > 0;

    // Request inspector: one entry per request that reached an agent,
    // written after the response (never on the request's critical path).
    let captured = false;
    let streamHead: { status: number; headers: Record<string, string> } | null = null;
    // First INSPECT_BODY_MAX_BYTES of a streamed body, plus its full size.
    const streamChunks: Buffer[] = [];
    let streamKept = 0;
    let streamSize = 0;
    const capture = (response: TunnelResponseMsg | null, error: string | null) => {
      if (captured) return;
      captured = true;
      // What the caller received: the app's status, or the hub's 502/504.
      const finalStatus = response?.status ?? streamHead?.status ?? (error === 'AGENT_TIMEOUT' ? 504 : 502);
      this.stats?.record(entryAccountId, label, finalStatus, Date.now() - startedAt, req.method ?? 'GET', req.url ?? '/');
      if (!this.inspector || this.isLoadTest(req)) return;
      const resHeaders = response?.headers ?? streamHead?.headers ?? {};
      const resBinary = response?.bodyEncoding ? response.bodyEncoding === 'base64' : isBinaryContentType(resHeaders['content-type']);
      const entry: InspectedRequest = {
        id: requestId,
        at: new Date(startedAt).toISOString(),
        label,
        accountSlug,
        host: hostname,
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        clientIp: replayOf ? null : clientIp(req),
        request: { headers: maskHeaders(forwardHeaders), body: captureBody(requestBody, isBinaryForInspector(req.headers['content-type'])) },
        response: response
          ? {
              status: response.status ?? 200,
              headers: maskHeaders(resHeaders),
              body: captureBody(response.body ? Buffer.from(response.body, resBinary ? 'base64' : 'utf8') : null, resBinary),
              streamed: false,
            }
          : streamHead
            ? {
                status: streamHead.status,
                headers: maskHeaders(streamHead.headers),
                body: { ...captureBody(Buffer.concat(streamChunks), resBinary), size: streamSize, truncated: streamSize > streamKept },
                streamed: true,
              }
            : null,
        durationMs: response?.durationMs ?? Date.now() - startedAt,
        error,
        replayOf,
        inboxId: this.inboxMarker(req),
        ...(plan.matched.length ? { ruleIds: plan.matched } : {}),
      };
      this.inspector.record(entryAccountId, entry);
    };
    const entryAccountId = entry.accountId;

    const forward: TunnelForwardMsg = {
      v: '1',
      type: 'tunnel:forward',
      requestId,
      method: req.method ?? 'GET',
      // A "rewrite" rule's path; otherwise the caller's.
      path: plan.path,
      query: '',
      headers: forwardHeaders,
      body: body,
      bodyEncoding,
      timeoutMs: requestTimeoutMs - 2000,
      // Only agents that announced "stream" get to stream (older agents
      // would ignore the flag anyway, but this keeps the hub honest).
      ...(agent.capabilities?.includes('stream') ? { acceptStream: true } : {}),
    };

    // The caller went away before the answer finished: stop waiting, and
    // tell the agent to abort the backend request (agents with "cancel";
    // audit part2 G13), instead of letting it run on for nobody.
    let settled = false;
    const onCallerGone = () => {
      if (settled) return;
      settled = true;
      if (this.pendingRegistry.drop(requestId) && agent.capabilities?.includes('cancel')) {
        try {
          agent.ws.send(serialize({ v: '1', type: 'tunnel:cancel', requestId } as any));
        } catch {
          // agent socket gone: nothing to cancel
        }
      }
    };
    res.on('close', () => {
      if (!res.writableFinished) onCallerGone();
    });

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
        agentId: agent.agentId,
        enqueuedAt: Date.now(),

        resolve: (response: TunnelResponseMsg) => {
          clearTimeout(timer);
          settled = true;
          if (hasResponseRules) {
            const headers: Record<string, string | string[]> = { ...(response.headers ?? {}) };
            applyResponseHeaders(headers, plan);
            this.writeResponse(res, { ...response, headers: headers as Record<string, string> });
          } else this.writeResponse(res, response);
          capture(response, null);
          outerResolve();
        },

        reject: (code: string, message: string) => {
          clearTimeout(timer);
          settled = true;
          capture(null, code);
          if (res.headersSent) {
            // Mid-stream: the status line is gone; cut the response so the
            // caller sees it end abnormally rather than hang.
            res.destroy();
          } else {
            const status = code === 'AGENT_TIMEOUT' ? 504 : 502;
            // Agent messages carry local detail (ports, loopback addresses,
            // errno strings) that must not reach the public (audit M10).
            this.sendError(res, status, publicAgentErrorMessage(code), { body: { code } });
            debugLog('[tunnel] agent error', code, message);
          }
          outerResolve();
        },

        timer,

        stream: forward.acceptStream
          ? {
              start: (status, headers) => {
                clearTimeout(timer);
                streamHead = { status: status || 200, headers };
                if (hasResponseRules) {
                  const h: Record<string, string | string[]> = { ...headers };
                  applyResponseHeaders(h, plan);
                  this.writeStreamHead(res, status, h as Record<string, string>);
                } else this.writeStreamHead(res, status, headers);
              },
              chunk: (data) => {
                res.write(data);
                streamSize += data.length;
                if (this.inspector && streamKept < INSPECT_BODY_MAX_BYTES) {
                  const part = data.subarray(0, INSPECT_BODY_MAX_BYTES - streamKept);
                  streamChunks.push(part);
                  streamKept += part.length;
                }
                // A caller that reads far slower than the backend writes
                // would otherwise pile the stream up in hub memory.
                if (res.writableLength > MAX_STREAM_BUFFER_BYTES) onCallerGone(), res.destroy();
              },
              end: (error) => {
                settled = true;
                capture(null, error ? 'STREAM_ERROR' : null);
                if (error) res.destroy();
                else res.end();
                outerResolve();
              },
            }
          : undefined,
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

  async handleWebSocket(req: IncomingMessage, socket: Socket, head: Buffer, route?: TunnelRoute): Promise<void> {
    const hostname = requestHostname(req);
    const parsed = route ?? this.parseSubdomain(hostname.slice(0, -(this.hubDomain.length + 1)));

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

    // Same access rules as plain HTTP (no redirect dance for share links:
    // a browser opening a WebSocket already carries the cookie).
    const wsAccess = await this.checkAccess(entry.accountId, label, req);
    if (!wsAccess.allow) {
      const line = wsAccess.status === 403 ? '403 Forbidden' : wsAccess.status === 429 ? '429 Too Many Requests' : '401 Unauthorized';
      socket.write(`HTTP/1.1 ${line}\r\n${wsAccess.status === 401 ? `WWW-Authenticate: Basic realm="${label}", charset="UTF-8"\r\n` : ''}\r\n`);
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
        headers: this.withoutTunnelCredentials(this.sanitizeHeaders(req.headers as Record<string, string>), wsAccess.stripAuthorization),
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
  /** Open browser WebSockets relayed through tunnels. */
  webSocketCount(): number {
    return this.tunnelWsRegistry.size();
  }

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

  /** What the tunnel's traffic rules do with this request (no rules: an empty plan). */
  private async trafficPlan(accountId: string, label: string, req: IncomingMessage, online: boolean): Promise<TrafficPlan> {
    // Replays and inbox deliveries are the hub's own: they already went through the rules.
    const rules = this.rules && !this.isInternal(req) ? await this.rules.get(accountId, label) : [];
    return evaluateTrafficRules(rules, { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers }, { online });
  }

  /**
   * A tunnel URL with no agent registered: answer from an "offline" rule
   * (mock or redirect) if one matches, after the same abuse limit and access
   * rules as live traffic. False when no rule answers.
   */
  private async tryOfflineRules(req: IncomingMessage, res: ServerResponse, label: string, accountSlug: string, hostname: string): Promise<boolean> {
    if (!this.rules || this.isInternal(req)) return false;
    const accountId = await this.rules.accountIdForSlug(accountSlug);
    if (!accountId) return false;
    const rules = await this.rules.get(accountId, label);
    if (!rules.some((r) => r.enabled && r.when === 'offline')) return false;
    const plan = evaluateTrafficRules(rules, { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers }, { online: false });
    if (!plan.respond) return false;

    if (this.usageLimiter && !this.isLoadTest(req)) {
      const rate = await this.usageLimiter.checkRequest(accountId);
      if (!rate.allowed) {
        this.sendError(res, 429, `Rate limit exceeded: ${rate.limitPerMinute} requests/min for this account's plan`, {
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        });
        return true;
      }
    }
    const access = await this.checkAccess(accountId, label, req);
    if (!access.allow) {
      this.sendAccessDenied(res, access, label);
      return true;
    }
    this.usageLimiter?.recordForwarded(accountId);
    await this.answerFromRule(req, res, plan, { accountId, label, accountSlug, hostname });
    return true;
  }

  /** Writes a rule's answer (mock, injected error, redirect) and records it like any other request. */
  /** Account and mock of a URL with no agent registered (the account comes from the slug). */
  private async offlineMock(label: string, accountSlug: string): Promise<{ accountId: string; mock: CachedMock } | null> {
    if (!this.mocks || !this.rules) return null;
    const accountId = await this.rules.accountIdForSlug(accountSlug);
    if (!accountId) return null;
    const mock = await this.mocks.get(accountId, label);
    return mock ? { accountId, mock } : null;
  }

  /** Same gates as live traffic (abuse limit, access rules), then the mock's answer. */
  private async answerOfflineMock(
    req: IncomingMessage,
    res: ServerResponse,
    found: { accountId: string; mock: CachedMock },
    ctx: { label: string; accountSlug: string; hostname: string },
  ): Promise<void> {
    const { accountId } = found;
    if (this.usageLimiter && !this.isLoadTest(req)) {
      const rate = await this.usageLimiter.checkRequest(accountId);
      if (!rate.allowed) {
        this.sendError(res, 429, `Rate limit exceeded: ${rate.limitPerMinute} requests/min for this account's plan`, {
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
          body: { retryAfterSeconds: rate.retryAfterSeconds },
        });
        return;
      }
    }
    const access = await this.checkAccess(accountId, ctx.label, req);
    if (!access.allow) {
      this.sendAccessDenied(res, access, ctx.label);
      return;
    }
    this.usageLimiter?.recordForwarded(accountId);
    await this.answerFromMock(req, res, found.mock, { accountId, ...ctx });
  }

  /**
   * Writes a hosted mock's answer and records it like any other request
   * (charts, inspector). The caller checked mockHandles(), so an answer exists.
   */
  private async answerFromMock(
    req: IncomingMessage,
    res: ServerResponse,
    mock: CachedMock,
    ctx: { accountId: string; label: string; accountSlug: string; hostname: string },
    plan?: TrafficPlan,
  ): Promise<void> {
    const startedAt = Date.now();
    let requestBody: Buffer | null = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        requestBody = await this.readBody(req, MAX_BODY_BYTES);
      } catch {
        if (!res.headersSent && !res.destroyed) this.sendError(res, 413, `Request body too large. Maximum is ${MAX_BODY_BYTES / 1024 / 1024}MB`);
        return;
      }
    }
    const mreq = { method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body: requestBody?.length ? requestBody.toString('utf8') : undefined };
    let answer: ReturnType<typeof resolveMock>;
    try {
      answer = mockHandles(mock.def, mreq)
        ? resolveMock(mock.def, mreq, { sequence: mock.sequence })
        : await resolveResource(mock.def, mreq, this.mockStore, { mockId: mock.def.id ?? `${ctx.accountId}:${ctx.label}` });
    } catch (err) {
      // The resource store (Redis) failed: say so instead of hanging or 500-ing blindly.
      console.warn({ err: (err as Error).message, label: ctx.label }, '[mocks] resource store failed');
      this.sendError(res, 503, 'The mock’s data store is unavailable right now. Try again shortly.', { code: 'MOCK_STORE_UNAVAILABLE' });
      return;
    }
    if (!answer) {
      // mockHandles() said yes; only a definition swapped mid-request gets here.
      this.sendError(res, 404, 'No mock endpoint matches this request.', { code: 'MOCK_NO_ROUTE' });
      return;
    }
    const wait = Math.min(60_000, answer.latencyMs + (plan?.delayMs ?? 0));
    if (wait > 0) await new Promise((done) => setTimeout(done, wait));
    if (res.destroyed) return;

    const headers: Record<string, string | string[]> = { ...answer.headers };
    if (plan) applyResponseHeaders(headers, plan);
    const noBody = req.method === 'HEAD' || answer.status === 204 || answer.status === 304 || (answer.status >= 100 && answer.status < 200);
    const payload = noBody ? Buffer.alloc(0) : Buffer.from(answer.body, 'utf8');
    headers['x-vhyxvoid-mock'] = answer.endpointId;
    headers['content-length'] = String(payload.length);
    try {
      res.writeHead(answer.status, headers);
    } catch {
      res.writeHead(answer.status, { 'content-length': String(payload.length), 'x-vhyxvoid-mock': answer.endpointId });
    }
    res.end(payload.length ? payload : undefined);

    const durationMs = Date.now() - startedAt;
    this.stats?.record(ctx.accountId, ctx.label, answer.status, durationMs, req.method ?? 'GET', req.url ?? '/');
    if (!this.inspector || this.isLoadTest(req)) return;
    const endpoint = mock.def.endpoints.find((e) => e.id === answer.endpointId);
    const response = endpoint?.responses.find((r) => r.id === answer.responseId);
    const resource = answer.endpointId.startsWith('resource:') ? mock.def.resources?.find((r) => `resource:${r.id}` === answer.endpointId) : undefined;
    const flat = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]));
    this.inspector.record(ctx.accountId, {
      id: `req_${randomUUID().replace(/-/g, '')}`,
      at: new Date(startedAt).toISOString(),
      label: ctx.label,
      accountSlug: ctx.accountSlug,
      host: ctx.hostname,
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      clientIp: clientIp(req),
      request: {
        headers: maskHeaders(this.withoutTunnelCredentials(this.sanitizeHeaders(req.headers as Record<string, string>), true)),
        body: captureBody(requestBody, isBinaryForInspector(req.headers['content-type'])),
      },
      response: { status: answer.status, headers: maskHeaders(flat), body: captureBody(payload, false), streamed: false },
      durationMs,
      error: null,
      replayOf: null,
      ruleIds: plan?.matched.length ? plan.matched : undefined,
      mock: {
        endpointId: answer.endpointId,
        responseId: answer.responseId,
        ...(endpoint ? { endpointName: endpoint.name || `${endpoint.method} ${endpoint.path}` } : {}),
        ...(resource ? { endpointName: `Resource ${resource.name}`, responseName: answer.responseId } : {}),
        ...(response?.name ? { responseName: response.name } : {}),
      },
    });
  }

  private async answerFromRule(
    req: IncomingMessage,
    res: ServerResponse,
    plan: TrafficPlan,
    ctx: { accountId: string; label: string; accountSlug: string; hostname: string },
  ): Promise<void> {
    const r = plan.respond!;
    const startedAt = Date.now();
    // Drain the body (keeps the connection reusable; the inspector shows it).
    let requestBody: Buffer | null = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        requestBody = await this.readBody(req, MAX_BODY_BYTES);
      } catch {
        if (!res.headersSent && !res.destroyed) this.sendError(res, 413, `Request body too large. Maximum is ${MAX_BODY_BYTES / 1024 / 1024}MB`);
        return;
      }
    }
    if (plan.delayMs > 0) await new Promise((done) => setTimeout(done, plan.delayMs));
    if (res.destroyed) return;

    const headers: Record<string, string | string[]> = { ...r.headers };
    applyResponseHeaders(headers, plan);
    const payload = Buffer.from(r.body, 'utf8');
    if (payload.length && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'text/plain; charset=utf-8';
    headers['x-vhyxvoid-rule'] = r.ruleId;
    headers['content-length'] = String(payload.length);
    try {
      res.writeHead(r.status, headers);
    } catch {
      // A header value the client library refuses: answer without the rule's headers.
      res.writeHead(r.status, { 'content-length': String(payload.length), 'x-vhyxvoid-rule': r.ruleId });
    }
    res.end(req.method === 'HEAD' ? undefined : payload);

    const durationMs = Date.now() - startedAt;
    this.stats?.record(ctx.accountId, ctx.label, r.status, durationMs, req.method ?? 'GET', req.url ?? '/');
    if (!this.inspector || this.isLoadTest(req)) return;
    const flat = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]));
    this.inspector.record(ctx.accountId, {
      id: `req_${randomUUID().replace(/-/g, '')}`,
      at: new Date(startedAt).toISOString(),
      label: ctx.label,
      accountSlug: ctx.accountSlug,
      host: ctx.hostname,
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      clientIp: clientIp(req),
      request: {
        headers: maskHeaders(this.withoutTunnelCredentials(this.sanitizeHeaders(req.headers as Record<string, string>), true)),
        body: captureBody(requestBody, isBinaryForInspector(req.headers['content-type'])),
      },
      response: { status: r.status, headers: maskHeaders(flat), body: captureBody(payload, false), streamed: false },
      durationMs,
      error: null,
      replayOf: null,
      ruleIds: plan.matched,
      answeredByRule: true,
    });
  }

  /** Access rules for this tunnel; fails closed if they cannot be read. */
  private async checkAccess(accountId: string, label: string, req: IncomingMessage): Promise<AccessDecision> {
    if (!this.policies) return { allow: true, stripAuthorization: false };
    // A dashboard replay or an inbox delivery: sent by this hub itself (the
    // API checked membership for replays; inbox rows passed the rules when stored).
    if (this.isInternal(req)) return { allow: true, stripAuthorization: false };
    try {
      const policy = await this.policies.get(accountId, label);
      const ip = clientIp(req);
      const guessKey = PasswordGuessLimiter.key(accountId, label, ip);
      if (policy?.passwordHash) {
        const wait = this.passwordGuesses.blockedFor(guessKey);
        if (wait > 0) return { allow: false, status: 429, reason: 'Too many wrong passwords. Try again shortly.', retryAfterSeconds: wait };
      }
      const decision = evaluateTunnelAccess(
        policy,
        { ip, authorization: req.headers.authorization, cookie: req.headers.cookie, url: req.url ?? '/' },
        this.pepper,
      );
      // Only a presented, wrong password counts as a guess (not the first unauthenticated visit).
      if (!decision.allow && decision.status === 401 && req.headers.authorization) this.passwordGuesses.fail(guessKey);
      return decision;
    } catch {
      return { allow: false, status: 403, reason: 'Access rules for this tunnel could not be checked. Try again shortly.' };
    }
  }

  private sendAccessDenied(res: ServerResponse, d: Exclude<AccessDecision, { allow: true }>, label: string): void {
    if (d.status === 302) {
      const secure = this.isSecureRequest(res.req);
      res.writeHead(302, {
        Location: d.location,
        'Set-Cookie': `${ACCESS_COOKIE}=${d.cookie.value}; Max-Age=${d.cookie.maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
        'Cache-Control': 'no-store',
        'Content-Length': 0,
      });
      res.end();
      return;
    }
    this.sendError(
      res,
      d.status,
      d.reason,
      d.status === 401
        ? { headers: { 'WWW-Authenticate': `Basic realm="${label}", charset="UTF-8"` } }
        : d.status === 429
          ? { headers: { 'Retry-After': String(d.retryAfterSeconds) } }
          : undefined,
    );
  }

  /** Drops the tunnel password (when it was used) and the share cookie, in place. */
  private withoutTunnelCredentials(headers: Record<string, string>, stripAuthorization: boolean): Record<string, string> {
    if (stripAuthorization) delete headers['authorization'];
    if (headers['cookie']?.includes(`${ACCESS_COOKIE}=`)) {
      const kept = stripAccessCookie(headers['cookie']);
      if (kept) headers['cookie'] = kept;
      else delete headers['cookie'];
    }
    return headers;
  }

  private isSecureRequest(req: IncomingMessage | undefined): boolean {
    if (!req) return false;
    const proto = req.headers['x-forwarded-proto'];
    return proto === 'https' || (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
  }

  /** The replayed request id, only when the hub itself sent this request. */
  private replayMarker(req: IncomingMessage): string | null {
    const of = req.headers['x-vhyxvoid-replay-of'];
    if (typeof of !== 'string' || !this.isInternal(req)) return null;
    return /^req_[a-f0-9]{32}$/.test(of) ? of : null;
  }

  /** The inbox row this request delivers, only when the hub itself sent it. */
  private inboxMarker(req: IncomingMessage): string | null {
    const id = req.headers[INBOX_DELIVERY_HEADER];
    if (typeof id !== 'string' || !this.isInternal(req)) return null;
    return /^[0-9a-f-]{36}$/.test(id) ? id : null;
  }

  /**
   * A load test from the API (phase 4): marked and carrying the internal
   * secret. It skips the per-minute abuse limit (the load test has its own
   * caps per plan) and the inspector (it would push real requests out); it
   * still counts as usage and in traffic and endpoint stats.
   */
  private isLoadTest(req: IncomingMessage): boolean {
    return typeof req.headers[LOAD_TEST_HEADER] === 'string' && this.isInternal(req);
  }

  /** Sent by this hub (replay, inbox delivery): carries HUB_INTERNAL_SECRET. */
  private isInternal(req: IncomingMessage): boolean {
    const secret = process.env.HUB_INTERNAL_SECRET;
    const given = req.headers['x-vhyxvoid-internal'];
    if (!secret || typeof given !== 'string') return false;
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Webhook inbox: a write request for a tunnel whose agent is offline is
   * stored and acknowledged with 202 when the tunnel's inbox is on.
   * Returns true when the response has been sent. Any inbox problem falls
   * back to the normal offline answer (returns false).
   */
  private async tryInbox(
    req: IncomingMessage,
    res: ServerResponse,
    knownAccountId: string | null,
    label: string,
    accountSlug: string,
    knownAccess?: AccessDecision,
  ): Promise<boolean> {
    if (!this.inbox || !isInboxMethod(req.method) || this.isInternal(req)) return false;
    let accountId = knownAccountId;
    try {
      accountId ??= await this.inbox.accountIdForSlug(accountSlug);
      if (!accountId) return false;
      const cfg = await this.inbox.configFor(accountId, label);
      if (!cfg.enabled) return false;
    } catch {
      return false;
    }

    // Same gates as live traffic: abuse limit and access rules.
    let access = knownAccess;
    if (!access) {
      if (this.usageLimiter && !this.isLoadTest(req)) {
        const rate = await this.usageLimiter.checkRequest(accountId);
        if (!rate.allowed) {
          this.sendError(res, 429, `Rate limit exceeded: ${rate.limitPerMinute} requests/min for this account's plan`, {
            headers: { 'Retry-After': String(rate.retryAfterSeconds) },
          });
          return true;
        }
      }
      access = await this.checkAccess(accountId, label, req);
      if (!access.allow) {
        this.sendAccessDenied(res, access, label);
        return true;
      }
    }
    if (!access.allow) return false;

    let body: Buffer;
    try {
      body = await this.readBody(req, INBOX_BODY_MAX_BYTES);
    } catch {
      if (!res.headersSent && !res.destroyed) {
        this.sendError(res, 413, `The tunnel is offline and its inbox keeps bodies up to ${INBOX_BODY_MAX_BYTES / 1024 / 1024} MB`);
      }
      return true;
    }

    const headers = this.withoutTunnelCredentials(inboxStoredHeaders(req.headers), access.stripAuthorization);
    try {
      const r = await this.inbox.tryStore(accountId, label, { method: req.method ?? 'POST', path: req.url ?? '/', headers, body });
      if (!r.stored) {
        if (r.reason === 'full') {
          this.sendError(res, 503, 'The tunnel is offline and its inbox is full. Try again later.', {
            headers: { 'Retry-After': '60' },
            code: 'TUNNEL_OFFLINE',
          });
          return true;
        }
        return false;
      }
      const json = JSON.stringify({ queued: true, id: r.id, message: 'The tunnel is offline; this request will be delivered when it reconnects.' });
      res.writeHead(INBOX_ACK_STATUS, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
        [INBOX_DELIVERY_HEADER]: r.id,
      });
      res.end(json);
      return true;
    } catch (err) {
      console.error({ err: (err as Error).message, accountId, label }, '[inbox] could not store request');
      return false;
    }
  }

  private parseSubdomain(subdomain: string): { label: string; accountSlug: string } | null {
    const separatorIndex = subdomain.indexOf('--');
    if (separatorIndex === -1) return null;

    const accountSlug = subdomain.slice(0, separatorIndex); // ← first part is now slug
    const label = subdomain.slice(separatorIndex + 2); // ← second part is label

    if (!label || !accountSlug) return null;
    return { label, accountSlug };
  }

  /** Status and headers of a streamed response; the body follows as chunks. */
  private writeStreamHead(res: ServerResponse, status: number, headers: Record<string, string>): void {
    for (const [key, value] of Object.entries(headers)) {
      const k = key.toLowerCase();
      if (this.isHopByHop(key) || k === 'content-length') continue;
      if (k === 'set-cookie') {
        res.setHeader('set-cookie', value.split('\n').filter(Boolean));
        continue;
      }
      try {
        res.setHeader(key, value);
      } catch {
        // Invalid header
      }
    }
    // Proxies (nginx) must pass each piece through immediately.
    res.setHeader('X-Accel-Buffering', 'no');
    res.writeHead(status || 200);
    res.flushHeaders();
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
    extra?: { headers?: Record<string, string>; body?: Record<string, unknown>; code?: string },
  ): void {
    // Marks the response as the hub's own (not the app's), with a reason
    // code; the webhook inbox relies on it to tell "offline" from "app error".
    const code =
      extra?.code ??
      (typeof extra?.body?.code === 'string' ? (extra.body.code as string) : null) ??
      (status === 429 ? 'RATE_LIMITED' : status === 401 || status === 403 ? 'ACCESS_DENIED' : status === 413 ? 'BODY_TOO_LARGE' : 'HUB_ERROR');
    const body = JSON.stringify({
      error: message,
      status,
      tunnel: true,
      ...(extra?.body ?? {}),
    });
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      [HUB_ERROR_HEADER]: code,
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
