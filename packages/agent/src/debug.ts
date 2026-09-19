// packages/agent/src/debug.ts
// Opt-in verbose logging for diagnosing the agent. Off by default: it is
// internal protocol chatter (one or more lines per message and per request),
// not something an end user running `vhyxvoid` should see. Enable with
// VHYXVOID_DEBUG_LOGGING=true (or `vhyxvoid --debug`). Same convention as the
// hub's HUB_DEBUG_LOGGING (apps/hub/src/utils/debug.ts): only the exact value
// "true" turns it on.
//
// Read on every call rather than once at import, because the CLI's --debug flag
// sets the variable after this module has loaded. Never pass secret material
// (keys, secrets, message bodies) to debugLog; the existing call sites log only
// message types, lengths and paths.

export function isDebugLogging(): boolean {
  return process.env.VHYXVOID_DEBUG_LOGGING === "true";
}

export function debugLog(...args: unknown[]): void {
  if (isDebugLogging()) console.log(...args);
}
