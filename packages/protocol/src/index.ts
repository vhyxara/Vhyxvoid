// packages/protocol/src/index.ts
// Single source of truth for the entire tunnel protocol.
// Imported by Hub, Agent, and SDK. Never duplicated.

export * from "./messages";
export * from "./canonical";
export * from "./serializer";
export * from "./constants";
export * from "./errors";
export * from "./bodyEncoding";
export * from "./closeCode";
export * from "./path";

// // Re-export for consumers that need the constant in canonical.ts
// import { PROTOCOL_VERSION } from "./constants";
// import type { HubErrorCode } from "./errors";
