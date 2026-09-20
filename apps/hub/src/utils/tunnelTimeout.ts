// apps/hub/src/utils/tunnelTimeout.ts
//
// Single source of truth for how long the hub waits for an agent to answer a
// tunneled request (HTTP tunnel path, SDK path, and the hub:pending TTL).
// Configured via TUNNEL_REQUEST_TIMEOUT_MS; falls back to the protocol default.

import { TIMING } from '@vhyxvoid/protocol';

// Below this, agent round-trips can't reliably finish; above this, we'd hold
// hub memory/sockets for a request nobody is realistically waiting on.
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 600_000;

// Redis hub:pending TTL sits slightly above the request timeout.
const PENDING_TTL_BUFFER_MS = 2_000;

let cached: number | null = null;

export function getTunnelRequestTimeoutMs(): number {
  if (cached !== null) return cached;

  const raw = process.env.TUNNEL_REQUEST_TIMEOUT_MS;
  let value: number = TIMING.REQUEST_TIMEOUT_MS;

  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_TIMEOUT_MS && parsed <= MAX_TIMEOUT_MS) {
      value = Math.floor(parsed);
    } else {
      console.warn(
        `[hub] ignoring TUNNEL_REQUEST_TIMEOUT_MS=${raw} (must be ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}); using ${value}`,
      );
    }
  }

  cached = value;
  return cached;
}

export function getPendingTtlMs(): number {
  return getTunnelRequestTimeoutMs() + PENDING_TTL_BUFFER_MS;
}
