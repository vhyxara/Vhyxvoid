// packages/shared/src/agentFleet.ts
//
// Agent fleet: version and health of connected agents, for the dashboard's
// Agents card, the console and the hub's minimum-version check. Versions are
// "major.minor.patch" with an optional "-prerelease" (lower than the release).
// Operators set the versions in the console (settings agents.*), so a new
// agent release needs no deploy to show users an "update" banner.

export type AgentVersionStatus = "current" | "outdated" | "unsupported" | "unknown";
export type AgentHealth = "healthy" | "lagging" | "unresponsive";

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/;

export function parseVersion(v: string | null | undefined): [number, number, number, string | null] | null {
  const m = typeof v === "string" ? VERSION.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? null] : null;
}

export function isValidVersion(v: unknown): boolean {
  return typeof v === "string" && parseVersion(v) !== null;
}

/** -1, 0 or 1; null when either side is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) < (y[i] as number) ? -1 : 1;
  if (x[3] === y[3]) return 0;
  if (x[3] === null) return 1; // 1.2.0 > 1.2.0-beta
  if (y[3] === null) return -1;
  return x[3] < y[3] ? -1 : 1;
}

/** Where an agent's version stands against the console's recommended and minimum versions (empty = not set). */
export function agentVersionStatus(version: string | null | undefined, recommended: string, minimum: string): AgentVersionStatus {
  if (!parseVersion(version)) return "unknown";
  if (minimum && compareVersions(version!, minimum) === -1) return "unsupported";
  if (recommended && compareVersions(version!, recommended) === -1) return "outdated";
  return "current";
}

/** The hub pings every 10 s; one missed pong is lag, two or more (or 45 s of silence) is trouble. */
export function agentHealth(lastSeenAt: Date | string, missedPings: number, now = Date.now()): AgentHealth {
  const silentMs = now - new Date(lastSeenAt).getTime();
  if (missedPings >= 2 || silentMs > 45_000) return "unresponsive";
  if (missedPings >= 1 || silentMs > 25_000) return "lagging";
  return "healthy";
}

/** Hub check at registration: the message for an agent below the minimum version, or null when it may connect. */
export function minimumVersionProblem(version: string | null | undefined, minimum: string): string | null {
  if (!minimum || !parseVersion(minimum)) return null;
  if (!parseVersion(version)) return `This agent does not report a version, and this platform needs ${minimum} or newer. Update: npm i -D @vhyxvoid/agent@latest`;
  if (compareVersions(version!, minimum) === -1) return `Agent ${version} is older than ${minimum}, the oldest version this platform accepts. Update: npm i -D @vhyxvoid/agent@latest`;
  return null;
}
