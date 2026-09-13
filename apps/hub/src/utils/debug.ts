// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/utils/debug.ts
// Opt-in verbose logging for local development. Off by default — nothing here
// should ever print secret material (hashes, peppers, raw keys); those lines
// were deleted outright rather than gated. See context.md risk #8 and
// decision.md, 2026-09-12, "Hub debug logging removed/gated".
// ─────────────────────────────────────────────────────────────────────────────

export const HUB_DEBUG_LOGGING = process.env.HUB_DEBUG_LOGGING === 'true';

export function debugLog(...args: unknown[]): void {
  if (HUB_DEBUG_LOGGING) console.log(...args);
}
