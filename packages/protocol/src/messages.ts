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
  requestId: string;
  ts: number;
  signature: string;
  agentVersion: string;
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
  messages: Array<TunnelResponseMsg | TunnelAgentErrorMsg | AgentPongMsg>;
}

// ── Hub → Agent ──────────────────────────────────────────────────────────────

export interface HubRegisteredMsg {
  v: "1";
  type: "hub:registered";
  agentId: string;
  accountId: string;
  replayPending: boolean;
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
  timeoutMs: number;
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
  | AgentBatchMsg;

export type HubToAgentMsg =
  | HubRegisteredMsg
  | HubPingMsg
  | TunnelForwardMsg
  | HubErrorMsg;

export type SdkToHubMsg = SdkRegisterMsg | SdkRequestMsg;

export type HubToSdkMsg = SdkRegisteredMsg | SdkResponseMsg | SdkErrorMsg;

export type AnyHubMsg =
  | AgentToHubMsg
  | HubToAgentMsg
  | SdkToHubMsg
  | HubToSdkMsg;
