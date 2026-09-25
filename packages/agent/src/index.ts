// packages/agent/src/index.ts
// Public API of the agent package when imported as a library (not CLI).
// Consumers who want to embed the agent in their own process import from here.

export { AgentClient } from "./AgentClient";
export type { AgentConfig, AgentState } from "./AgentClient";
export { BackendProxy } from "./proxy/BackendProxy";
export { ResponseCache } from "./cache/ResponseCache";
export type { CachedResponse } from "./cache/ResponseCache";
export { MessageBatcher } from "./batcher/MessageBatcher";
export { LocalDiscoveryServer } from "./discovery/LocalDiscoveryServer";
export type { DiscoveryPayload } from "./discovery/LocalDiscoveryServer";
