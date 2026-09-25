// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/messages.ts
// All messages as strict discriminated unions.
// Both Hub and Agent import these — no duplication.
// ─────────────────────────────────────────────────────────────────────────────

import type { HubErrorCode, TunnelErrorCode } from "./errors";

// ── Agent → Hub ──────────────────────────────────────────────────────────────

export interface AgentRegisterMsg {
  v: "1";
  type: "agent:register";
  keyId: string;
  label: string;
  rawSecret: string;
  agentVersion: string;
  /**
   * Optional features this agent understands (since 2026-09-25). The hub
   * uses a feature only if the agent announced it, so old agents keep
   * working unchanged. See AGENT_CAPABILITIES.
   */
  capabilities?: AgentCapability[];
}

/**
 * - "stream": may answer a tunnel:forward that has acceptStream with
 *   tunnel:response:start / :chunk / :end instead of one tunnel:response
 *   (Server-Sent Events, NDJSON, chunked responses).
 * - "cancel": understands tunnel:cancel (the caller went away; abort the
 *   request to the local backend).
 */
export type AgentCapability = "stream" | "cancel";
export const AGENT_CAPABILITIES: AgentCapability[] = ["stream", "cancel"];

/** Head of a streamed response (agent -> hub). */
export interface TunnelResponseStartMsg {
  v: "1";
  type: "tunnel:response:start";
  requestId: string;
  status: number;
  headers: Record<string, string>;
}

/** One piece of a streamed response body, base64 (agent -> hub). */
export interface TunnelResponseChunkMsg {
  v: "1";
  type: "tunnel:response:chunk";
  requestId: string;
  data: string;
}

/** End of a streamed response; `error` set if the backend stream failed. */
export interface TunnelResponseEndMsg {
  v: "1";
  type: "tunnel:response:end";
  requestId: string;
  durationMs: number;
  error?: string;
}

/** The public caller disconnected; stop working on this request (hub -> agent). */
export interface TunnelCancelMsg {
  v: "1";
  type: "tunnel:cancel";
  requestId: string;
}

export interface AgentPongMsg {
  v: "1";
  type: "agent:pong";
  agentId: string;
  ts: number;
}

export interface TunnelResponseMsg {
  v: "1";
  type: "tunnel:response";
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string | null;
  /**
   * How `body` is encoded. Optional for backward compatibility with an
   * older agent that never set it — a receiver seeing it undefined should
   * fall back to the pre-existing content-type-sniffing heuristic, not
   * assume "utf8". See context.md risk #21.
   */
  bodyEncoding?: "utf8" | "base64";
  durationMs: number;
}

export interface TunnelAgentErrorMsg {
  v: "1";
  type: "tunnel:agent-error";
  requestId: string;
  code: TunnelErrorCode;
  message: string;
}

export interface AgentBatchMsg {
  v: "1";
  type: "agent:batch";
  // The tunnel:ws:* members are accepted from agents that still batch WebSocket
  // frames (agents before the WS-relay fix did); current agents send them
  // unbatched. Hub-side handling must stay for the mixed-version window.
  messages: Array<
    | TunnelResponseMsg
    | TunnelAgentErrorMsg
    | AgentPongMsg
    | TunnelWsMessageMsg
    | TunnelWsCloseMsg
    | TunnelWsErrorMsg
  >;
}

// ── Hub → Agent ──────────────────────────────────────────────────────────────

export interface HubRegisteredMsg {
  v: "1";
  type: "hub:registered";
  agentId: string;
  accountId: string;
  replayPending: boolean;
  tunnelUrl?: string; // ← ADD — stable public HTTPS URL
}

export interface HubPingMsg {
  v: "1";
  type: "hub:ping";
  ts: number;
}

export interface TunnelForwardMsg {
  v: "1";
  type: "tunnel:forward";
  requestId: string;
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string | null;
  /**
   * How `body` is encoded — mirrors TunnelResponseMsg.bodyEncoding, same
   * meaning, opposite direction. Optional for backward compatibility with
   * an older hub that never sets it (e.g. the WS sdk:request path, whose
   * body is always JSON.stringify'd text and never sets this field) — a
   * receiver seeing it undefined should treat `body` as plain utf8, not
   * attempt to decode it. See context.md risk #21.
   */
  bodyEncoding?: "utf8" | "base64";
  timeoutMs: number;
  /**
   * The caller can take a streamed answer (hub sets it only for agents that
   * announced "stream", on the public HTTP path). The agent then streams
   * responses that are streams by nature and answers everything else with a
   * single tunnel:response as before.
   */
  acceptStream?: boolean;
}

export interface HubErrorMsg {
  v: "1";
  type: "hub:error";
  code: HubErrorCode;
  message: string;
  requestId?: string;
  fatal: boolean;
}

// ── SDK → Hub ────────────────────────────────────────────────────────────────

export interface SdkRegisterMsg {
  v: "1";
  type: "sdk:register";
  keyId: string;
  requestId: string;
  ts: number;
  signature: string;
  /**
   * The key's raw secret, sent once per connection over TLS, like
   * agent:register (since 2026-09-25). The hub verifies it against the
   * stored hash and then checks each sdk:request's raw-secret signature.
   */
  rawSecret?: string;
}

export interface SdkRequestMsg {
  v: "1";
  type: "sdk:request";
  keyId: string;
  requestId: string;
  ts: number;
  signature: string;
  label?: string;
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string | null;
}

// ── Hub → SDK ────────────────────────────────────────────────────────────────

export interface SdkRegisteredMsg {
  v: "1";
  type: "sdk:registered";
  sessionId: string;
}

export interface SdkResponseMsg {
  v: "1";
  type: "sdk:response";
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string | null;
  /** See TunnelResponseMsg.bodyEncoding — same meaning, passed through as-is. */
  bodyEncoding?: "utf8" | "base64";
  durationMs: number;
}

export interface SdkErrorMsg {
  v: "1";
  type: "sdk:error";
  requestId: string;
  code: TunnelErrorCode | HubErrorCode;
  message: string;
  retryable: boolean;
}

// ── Union types ───────────────────────────────────────────────────────────────

export type AgentToHubMsg =
  | AgentRegisterMsg
  | AgentPongMsg
  | TunnelResponseMsg
  | TunnelAgentErrorMsg
  | AgentBatchMsg
  | TunnelWsMessageMsg
  | TunnelWsCloseMsg
  | TunnelResponseStartMsg
  | TunnelResponseChunkMsg
  | TunnelResponseEndMsg;

export type HubToAgentMsg =
  | HubRegisteredMsg
  | HubPingMsg
  | TunnelForwardMsg
  | HubErrorMsg
  | TunnelWsOpenMsg
  | TunnelWsMessageMsg
  | TunnelWsCloseMsg
  | TunnelCancelMsg;

export type SdkToHubMsg = SdkRegisterMsg | SdkRequestMsg;

export type HubToSdkMsg = SdkRegisteredMsg | SdkResponseMsg | SdkErrorMsg;

export type AnyHubMsg =
  | AgentToHubMsg
  | HubToAgentMsg
  | SdkToHubMsg
  | HubToSdkMsg
  | TunnelWsErrorMsg;

// ── WebSocket tunnel messages ─────────────────────────────────────────────

export interface TunnelWsOpenMsg {
  v: "1";
  type: "tunnel:ws:open";
  connectionId: string; // unique per WS connection
  path: string;
  query: string;
  headers: Record<string, string>;
}

export interface TunnelWsMessageMsg {
  v: "1";
  type: "tunnel:ws:message";
  connectionId: string;
  data: string; // base64 for binary, raw for text
  isBinary: boolean;
}

export interface TunnelWsCloseMsg {
  v: "1";
  type: "tunnel:ws:close";
  connectionId: string;
  code: number;
  reason: string;
}

export interface TunnelWsErrorMsg {
  v: "1";
  type: "tunnel:ws:error";
  connectionId: string;
  message: string;
}
