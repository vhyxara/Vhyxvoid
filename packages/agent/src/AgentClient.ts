// packages/agent/src/AgentClient.ts
// Main agent class. State machine with reconnect. Single WS connection.

import WebSocket from "ws";
// import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import fs from "fs";
import {
  parseMessage,
  serialize,
  ProtocolError,
  // buildCanonical,
  // signCanonical,
  HubRegisteredMsg,
  HubPingMsg,
  TunnelForwardMsg,
  HubErrorMsg,
  AgentRegisterMsg,
  AgentPongMsg,
  TIMING,
  PROTOCOL_VERSION,
  TunnelAgentErrorMsg,
  TunnelResponseMsg,
  TunnelWsOpenMsg,
  TunnelWsMessageMsg,
  TunnelWsCloseMsg,
  TunnelWsErrorMsg,
} from "@vhyxvoid/protocol";
import { DurableQueue } from "./queue/DurableQueue";
import { NoOpQueue } from "./queue/NoOpQueue";
import { AGENT_VERSION } from "./version";
import { debugLog } from "./debug";
import { BackendProxy } from "./proxy/BackendProxy";
import { MessageBatcher } from "./batcher/MessageBatcher";
import { replayQueue } from "./replay/replayQueue";
import { LocalDiscoveryServer } from "./discovery/LocalDiscoveryServer";

// Bounds for responses held in memory during a hub outage (see heldResponses).
const MAX_HELD_RESPONSES = 100;
const MAX_HELD_BYTES = 20 * 1024 * 1024;

export type AgentState =
  | "IDLE"
  | "CONNECTING"
  | "AUTHENTICATING"
  | "CONNECTED"
  | "RECONNECTING"
  | "STOPPED";

// ── Config ────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  /** Hub WebSocket URL e.g. wss://hub.yourplatform.com/agent */
  hubUrl: string;
  /** API key public ID e.g. vhyxvoid_dev_abc123 */
  keyId: string;
  /**
   * secretHash = HMAC-SHA256(rawSecret, SERVER_HMAC_PEPPER).
   * The CLI hashes the raw secret on startup so it's never kept in memory.
   */
  secret: string;
  /** Tunnel label — identifies this agent if an account has multiple agents */
  label: string;
  /** Local backend port to forward requests to */
  port: number;
  /**
   * Version reported to the hub. Defaults to this package's own version
   * (AGENT_VERSION); only override it to report something else on purpose.
   */
  agentVersion?: string;
  /** SQLite queue file path (default: ~/.vhyxvoid/queue.db) */
  queuePath?: string;
  /** Enable local discovery HTTP server on port 4242 (default: true) */
  localDiscovery?: boolean;
  /** Called whenever the agent state changes */
  onStateChange?: (state: AgentState) => void;

  /** Called once with the public tunnel URL after hub:registered */
  onTunnelUrl?: (tunnelUrl: string) => void;

  /** Called on each log event — defaults to console */
  logger?: {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  };
  /** Disable durable queue (SQLite). Use when running in-process. Default: false */
  disableQueue?: boolean;
}

/**
 * Hub errors that no retry can fix: the key or secret is wrong, revoked,
 * expired or lacks tunnel:connect, or the agent is too old. The agent stops
 * instead of reconnecting forever. INVALID_SIGNATURE is not in HubErrorCode
 * but is what the hub sends for a wrong secret (HubAuthError).
 */
const FATAL_STOP_CODES: ReadonlySet<string> = new Set([
  "AUTH_FAILED",
  "VERSION_UNSUPPORTED",
  "INVALID_SIGNATURE",
  "SCOPE_MISSING",
  "KEY_REVOKED",
  "KEY_EXPIRED",
]);

export class AgentClient {
  private state: AgentState = "IDLE";
  private ws: WebSocket | null = null;
  private agentId: string | null = null;
  private reconnectDelay: number = TIMING.RECONNECT_INITIAL_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped: boolean = false;

  private readonly queue: DurableQueue | NoOpQueue;
  private readonly proxy: BackendProxy;
  private readonly batcher: MessageBatcher;
  /**
   * Responses finished while the hub link was down, held IN MEMORY ONLY and
   * sent after the next hub:registered. They used to be written to the
   * SQLite queue, which put full response bodies (session tokens, PII) on
   * disk unencrypted, for as long as the agent stayed offline (audit part2
   * G3). Holding them still matters: after a half-open drop, a same-label
   * reconnect replaces the hub's session without rejecting its pending
   * requests, so a response sent within the hub's pending window is still
   * delivered. Bounded by count, bytes and that window.
   */
  private heldResponses: { msg: TunnelResponseMsg | TunnelAgentErrorMsg; bytes: number; heldAt: number }[] = [];
  private heldBytes = 0;
  private readonly discovery: LocalDiscoveryServer | null;
  private readonly log: NonNullable<AgentConfig["logger"]>;

  constructor(private readonly config: AgentConfig) {
    this.log = config.logger ?? {
      info: (obj, msg) => console.info(msg ?? "", obj),
      warn: (obj, msg) => console.warn(msg ?? "", obj),
      error: (obj, msg) => console.error(msg ?? "", obj),
    };

    const useQueue = config.disableQueue !== true;
    if (useQueue) {
      const queuePath =
        config.queuePath ?? path.join(os.homedir(), ".vhyxvoid", "queue.db");
      fs.mkdirSync(path.dirname(queuePath), { recursive: true });
      this.queue = new DurableQueue(queuePath);
    } else {
      this.queue = new NoOpQueue();
    }
    this.proxy = new BackendProxy(config.port);

    this.batcher = new MessageBatcher(
      // onFlush: send over WS
      (data) => this.sendRaw(data),
      // onQueueFallback: WS is down, hold in memory until re-registered
      (msg) => this.holdResponse(msg),
      // isConnected: checked before every flush
      () => this.state === "CONNECTED",
    );

    const useDiscovery = config.localDiscovery !== false;
    this.discovery = useDiscovery
      ? new LocalDiscoveryServer({
          agentVersion: config.agentVersion ?? AGENT_VERSION,
          label: config.label,
          port: config.port,
          accountIdHash: "", // populated after hub:registered
        })
      : null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.state !== "IDLE") {
      throw new Error(
        "AgentClient already started. Create a new instance to restart.",
      );
    }
    this.discovery?.start();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.setState("STOPPED");
    // Shutting down: nothing will ever send these.
    this.batcher.flushToQueue();
    this.heldResponses = [];
    this.heldBytes = 0;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, "agent_stopped");
    this.proxy.stop();
    this.discovery?.stop();
    this.queue.close();
  }

  getState(): AgentState {
    return this.state;
  }
  getQueueStatus() {
    return this.queue.count();
  }
  getCacheStats() {
    return this.proxy.getCacheStats();
  }

  // ── WS connection lifecycle ─────────────────────────────────────────────────

  private connect(): void {
    if (this.stopped) return;
    this.setState("CONNECTING");

    const ws = new WebSocket(this.config.hubUrl, {
      perMessageDeflate: true,
      handshakeTimeout: 10_000,
    });
    this.ws = ws;

    ws.on("open", () => this.onOpen());
    ws.on("message", (data) => this.onMessage(data as Buffer));
    ws.on("close", (code, reason) => this.onClose(code, reason.toString()));
    ws.on("error", (err) => this.onError(err));
  }

  private onOpen(): void {
    debugLog("[agent] WS OPEN, sending register");

    this.setState("AUTHENTICATING");
    // Backoff resets in onRegistered, not here: a TCP open followed by an
    // auth rejection is not a success, and resetting on open made every
    // rejected attempt retry after the initial 1 s forever.

    // const now = Date.now();
    // const requestId = randomUUID();

    // const canonical = buildCanonical({
    //   method: "AGENT_REGISTER",
    //   path: "/agent/register",
    //   query: "",
    //   body: this.config.label,
    //   requestId,
    //   ts: now,
    // });

    const msg: AgentRegisterMsg = {
      v: PROTOCOL_VERSION,
      type: "agent:register",
      keyId: this.config.keyId,
      label: this.config.label,

      // agentVersion: this.config.agentVersion,

      rawSecret: this.config.secret, // ← raw secret, hub applies pepper

      agentVersion: this.config.agentVersion ?? AGENT_VERSION,
    };

    this.sendRaw(serialize(msg));
    this.log.info(
      { label: this.config.label, keyId: this.config.keyId },
      "[agent] authenticating with hub",
    );
  }

  private onMessage(data: Buffer): void {
    debugLog("[agent] RAW MESSAGE RECEIVED, length:", data.length);
    let msg: ReturnType<typeof parseMessage>;
    try {
      msg = parseMessage(data);
    } catch (err) {
      console.error("[agent] parse error:", err);

      if (err instanceof ProtocolError) {
        this.log.warn(
          {
            code: err.code,
            message: `Local backend on port ${this.config.port} is not responding: ${(err as Error).message}`,
          }, // ← this is fine, err IS ProtocolError here
          "[agent] protocol error from hub",
        );
      }
      return;
    }
    debugLog("[agent] parsed message type:", msg.type);

    switch (msg.type) {
      case "hub:registered":
        return void this.onRegistered(msg as HubRegisteredMsg);
      case "hub:ping":
        return this.onPing(msg as HubPingMsg);
      case "hub:error":
        return this.onHubError(msg as HubErrorMsg);
      case "tunnel:forward":
        return void this.onForward(msg as TunnelForwardMsg);
      case "tunnel:ws:open":
        return void this.onWsOpen(msg as TunnelWsOpenMsg);
      case "tunnel:ws:message":
        return this.onWsMessage(msg as TunnelWsMessageMsg);
      case "tunnel:ws:close":
        return this.onWsClose(msg as TunnelWsCloseMsg);
      default:
        this.log.warn(
          { type: (msg as any).type },
          "[agent] unknown message type from hub",
        );
    }
  }

  private async onRegistered(msg: HubRegisteredMsg): Promise<void> {
    this.agentId = msg.agentId;
    this.reconnectDelay = TIMING.RECONNECT_INITIAL_MS; // reset backoff on success
    this.setState("CONNECTED");
    console.log("");
    console.log("  ✅  Tunnel active");
    console.log("");
    if (msg.tunnelUrl) {
      this.config.onTunnelUrl?.(msg.tunnelUrl);
      console.log(`  Local:   http://localhost:${this.config.port}`);
      console.log(`  Public:  ${msg.tunnelUrl}`);
      console.log("");
      console.log("  Share the Public URL — it is stable and never changes.");
      console.log("  Put it in webhooks, .env files, or share with teammates.");
    } else {
      console.log(`  Local:  http://localhost:${this.config.port}`);
      console.log(`  Label:  ${this.config.label}`);
    }
    console.log("");

    this.log.info(
      {
        agentId: msg.agentId,
        accountId: msg.accountId,
        label: this.config.label,
        port: this.config.port,
      },
      "[agent] ✅ tunnel is live",
    );

    this.sendHeldResponses();

    // Replay durable queue AFTER state = CONNECTED so sendRaw works
    const counts = this.queue.count();
    if (counts.ready > 0) {
      this.log.info({ items: counts.ready }, "[agent] replaying queue");
      const result = await replayQueue(
        this.queue,
        (data) => this.sendRaw(data),
        this.proxy,
      );
      this.log.info(result, "[agent] queue replay complete");
    }
  }

  private onPing(msg: HubPingMsg): void {
    debugLog("[agent] PING received, sending pong, agentId:", this.agentId);
    if (!this.agentId) {
      debugLog("[agent] no agentId, skipping pong");

      return;
    }
    const pong: AgentPongMsg = {
      v: PROTOCOL_VERSION,
      type: "agent:pong",
      agentId: this.agentId,
      ts: Date.now(),
    };
    debugLog("[agent] pong queued in batcher");

    this.batcher.add(pong);
  }

  private onHubError(msg: HubErrorMsg): void {
    this.log.error(
      { code: msg.code, message: msg.message, fatal: msg.fatal },
      "[agent] hub error",
    );

    if (!msg.fatal) return;

    if (FATAL_STOP_CODES.has(msg.code)) {
      console.error(
        `\n❌ Fatal error: ${msg.message}\n` +
          `   Check your API key and agent version, then restart.\n`,
      );
      this.stop();
      return;
    }

    // AGENT_LIMIT_REACHED (and any other fatal code): keep retrying, since
    // the user may free up a slot. The hub closes the socket and onClose
    // reconnects with exponential backoff (1 s, 2 s, 4 s ... 5 min), which
    // no longer resets on each rejected attempt.
  }

  private async onForward(msg: TunnelForwardMsg): Promise<void> {
    debugLog("[agent] FORWARD received:", msg.method, msg.path);

    // Invalidate related cache entries on mutating requests
    this.proxy.invalidateCacheFor(msg.method, msg.path);

    try {
      const result = await this.proxy.forward(msg);
      const response: TunnelResponseMsg = {
        v: PROTOCOL_VERSION,
        type: "tunnel:response",
        requestId: msg.requestId,
        ...result,
      };
      this.batcher.add(response);
    } catch (err) {
      // Never leave a request unanswered — always send an error back
      const agentError: TunnelAgentErrorMsg = {
        v: PROTOCOL_VERSION,
        type: "tunnel:agent-error",
        requestId: msg.requestId,
        code: "BACKEND_UNAVAILABLE",
        message: `Local backend on port ${this.config.port} is not responding: ${(err as Error).message}`,
      };

      // If WS is up, batcher sends it; if down, it goes to durable queue
      this.batcher.add(agentError);
    }
  }

  private onWsOpen(msg: TunnelWsOpenMsg): void {
    debugLog("[agent] WS open request:", msg.path);

    this.proxy.openWebSocket(
      msg.connectionId,
      msg.path,
      msg.query,
      msg.headers,
      // Backend → Hub
      (data, isBinary) => {
        const frame: TunnelWsMessageMsg = {
          v: "1",
          type: "tunnel:ws:message",
          connectionId: msg.connectionId,
          data,
          isBinary,
        };
        // Same ordered channel as :close and :error — NOT the batcher. Batching
        // let a close overtake buffered frames (they flushed up to 50ms later,
        // into an already-closed socket), added up to 50ms latency to every
        // frame, and a batch that reached an older hub was dropped whole.
        // Frames are also never worth persisting: if the hub link is down the
        // connection is dead (onClose closes it), so sendRaw's no-op is right and
        // the durable queue must not fill with frames for dead connections.
        this.sendRaw(serialize(frame));
      },
      // Backend closed
      (code, reason) => {
        const close: TunnelWsCloseMsg = {
          v: "1",
          type: "tunnel:ws:close",
          connectionId: msg.connectionId,
          code,
          reason,
        };
        this.sendRaw(serialize(close));
      },
      // Error
      (message) => {
        const err: TunnelWsErrorMsg = {
          v: "1",
          type: "tunnel:ws:error",
          connectionId: msg.connectionId,
          message,
        };
        this.sendRaw(serialize(err));
      },
    );
  }

  private onWsMessage(msg: TunnelWsMessageMsg): void {
    this.proxy.sendWebSocketMessage(msg.connectionId, msg.data, msg.isBinary);
  }

  private onWsClose(msg: TunnelWsCloseMsg): void {
    try {
      this.proxy.closeWebSocket(msg.connectionId, msg.code, msg.reason);
    } catch (err) {
      console.error("[agent] onWsClose error:", err);
    }
  }

  private onClose(code: number, reason: string): void {
    debugLog("[agent] WS CLOSED, code:", code, "reason:", reason);

    if (this.stopped) return;
    this.log.warn({ code, reason }, "[agent] WS closed — scheduling reconnect");
    // Tunnel WebSockets do not survive a hub reconnect (the hub closes the
    // browser side on its end). Close the backend sockets now, or they stay
    // open on the developer's server with nobody on the other end.
    this.proxy.closeAllWebSockets();
    this.batcher.flushToQueue(); // hold buffered responses in memory
    this.setState("RECONNECTING");
    this.scheduleReconnect();
  }

  private onError(err: Error): void {
    debugLog("[agent] WS ERROR:", err.message);

    // WS error is always followed by close — just log
    this.log.warn({ message: err.message }, "[agent] WS error");
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, TIMING.RECONNECT_MAX_MS);
    this.log.info({ delayMs: delay }, "[agent] reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private holdResponse(msg: TunnelResponseMsg | TunnelAgentErrorMsg): void {
    const bytes = Buffer.byteLength(JSON.stringify(msg));
    this.heldResponses.push({ msg, bytes, heldAt: Date.now() });
    this.heldBytes += bytes;
    while (
      this.heldResponses.length > MAX_HELD_RESPONSES ||
      (this.heldBytes > MAX_HELD_BYTES && this.heldResponses.length > 1)
    ) {
      const dropped = this.heldResponses.shift()!;
      this.heldBytes -= dropped.bytes;
    }
  }

  /** Sends what was held during the outage, minus anything the hub has already given up on. */
  private sendHeldResponses(): void {
    const held = this.heldResponses;
    this.heldResponses = [];
    this.heldBytes = 0;
    const cutoff = Date.now() - TIMING.REQUEST_TIMEOUT_MS;
    let dropped = 0;
    for (const { msg, heldAt } of held) {
      if (heldAt < cutoff) {
        dropped++;
        continue;
      }
      this.batcher.add(msg);
    }
    if (held.length > 0) {
      debugLog("[agent] sent held responses:", held.length - dropped, "expired:", dropped);
    }
  }

  private sendRaw(data: string): void {
    debugLog(
      "[agent] sendRaw, ws state:",
      this.ws?.readyState,
      "data length:",
      data.length,
    );

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private setState(state: AgentState): void {
    if (this.state === state) return;
    this.state = state;
    this.config.onStateChange?.(state);
  }
}
