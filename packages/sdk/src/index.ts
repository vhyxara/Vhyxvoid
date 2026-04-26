// packages/sdk/src/index.ts — public exports
// export { TunnelClient, TunnelError, TunnelTimeoutError };
// export type { TunnelClientConfig, TunnelResponse, RequestOptions };

// ─────────────────────────────────────────────────────────────────────────────
// packages/sdk/src/index.ts
// Public API of the SDK package.
// ─────────────────────────────────────────────────────────────────────────────

// export { TunnelClient, TunnelError, TunnelTimeoutError } from "./TunnelClient";
// export type {
//   TunnelClientConfig,
//   TunnelResponse,
//   RequestOptions,
// } from "./TunnelClient";
//
// NOTE: The SDK's TunnelClient.ts already has these exports at the bottom.
// This file is the barrel that npm consumers import from.
// In your project, create packages/sdk/src/index.ts with these lines uncommented.

export { TunnelClient } from "./TunnelClient";

export type {
  TunnelClientConfig,
  TunnelResponse,
  RequestOptions,
} from "./types";

export { TunnelError, TunnelTimeoutError } from "./types";
