// packages/shared/src/alerts.ts
//
// Alert rules (Prisma AlertRule / AlertState / AlertEvent). apps/api's alert
// worker evaluates them once a minute; these are the pure parts.
//
// Two kinds of rule:
//   state rules   TUNNEL_OFFLINE, ERROR_RATE, USAGE: each evaluation gives
//                 the set of subjects (tunnel labels, or a usage period) that
//                 are firing now; a subject notifies once when it starts
//                 firing and once when it recovers (diffAlertStates).
//   event rules   INBOX_FAILED, DOMAIN: something happened (a webhook gave
//                 up, a domain stopped pointing at us); each event notifies.

export const ALERT_TYPES = ["TUNNEL_OFFLINE", "ERROR_RATE", "USAGE", "INBOX_FAILED", "DOMAIN"] as const;
export type AlertTypeName = (typeof ALERT_TYPES)[number];

export const ALERT_DEFAULTS = {
  TUNNEL_OFFLINE: { windowMinutes: 5 },
  ERROR_RATE: { threshold: 10, windowMinutes: 5, minRequests: 20 },
  USAGE: { threshold: 80 },
} as const;

/** Bounds the API enforces on rule settings. */
export const ALERT_BOUNDS = {
  windowMinutes: { min: 1, max: 1440 },
  threshold: { min: 1, max: 100 },
  minRequests: { min: 1, max: 1_000_000 },
  emails: 10,
} as const;

/** At most this many notifications per rule per hour (a flapping tunnel must not flood inboxes). */
export const ALERT_MAX_NOTIFICATIONS_PER_HOUR = 12;

/** A tunnel that went offline longer ago than this is not alerted on by an "all tunnels" rule (it is gone, not down). */
export const ALERT_OFFLINE_LOOKBACK_HOURS = 24;

export interface AlertRuleLike {
  type: AlertTypeName;
  label: string | null;
  threshold: number | null;
  windowMinutes: number | null;
  minRequests: number | null;
}

export interface TunnelPresence {
  label: string;
  connected: boolean;
  /** When the most recent connection ended (null when connected or unknown). */
  lastDisconnectedAt: Date | null;
}

/** Labels offline for at least the rule's window. */
export function offlineSubjects(rule: AlertRuleLike, tunnels: TunnelPresence[], now: number): string[] {
  const windowMs = (rule.windowMinutes ?? ALERT_DEFAULTS.TUNNEL_OFFLINE.windowMinutes) * 60_000;
  const lookback = ALERT_OFFLINE_LOOKBACK_HOURS * 3_600_000 + windowMs;
  return tunnels
    .filter((t) => (rule.label ? t.label === rule.label : true))
    .filter((t) => {
      if (t.connected || !t.lastDisconnectedAt) return false;
      const since = now - t.lastDisconnectedAt.getTime();
      if (since < windowMs) return false;
      // A named tunnel stays "down" until it is back; "any tunnel" forgets old ones.
      return rule.label ? true : since <= lookback;
    })
    .map((t) => t.label)
    .sort();
}

export interface TunnelErrorStats {
  label: string;
  requests: number;
  errors5xx: number;
}

/** Labels whose share of 5xx answers over the window reaches the threshold. */
export function errorRateSubjects(rule: AlertRuleLike, stats: TunnelErrorStats[]): Array<{ label: string; rate: number; requests: number; errors: number }> {
  const threshold = rule.threshold ?? ALERT_DEFAULTS.ERROR_RATE.threshold;
  const minRequests = rule.minRequests ?? ALERT_DEFAULTS.ERROR_RATE.minRequests;
  return stats
    .filter((s) => (rule.label ? s.label === rule.label : true))
    .filter((s) => s.requests >= minRequests && s.requests > 0)
    .map((s) => ({ label: s.label, requests: s.requests, errors: s.errors5xx, rate: Math.round((s.errors5xx / s.requests) * 1000) / 10 }))
    .filter((s) => s.rate >= threshold)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** "usage:2026-10:80" when this month's usage reached the threshold of the limit; null otherwise. */
export function usageSubject(rule: AlertRuleLike, used: number, limit: number, now: number): { subject: string; percent: number } | null {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const threshold = rule.threshold ?? ALERT_DEFAULTS.USAGE.threshold;
  const percent = Math.floor((used / limit) * 100);
  if (percent < threshold) return null;
  const d = new Date(now);
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return { subject: `usage:${month}:${threshold}`, percent };
}

/** Which subjects start firing and which recover, given what was firing before. */
export function diffAlertStates(previous: Array<{ subject: string; firing: boolean }>, firingNow: string[]): { fire: string[]; resolve: string[] } {
  const was = new Set(previous.filter((p) => p.firing).map((p) => p.subject));
  const now = new Set(firingNow);
  return {
    fire: [...now].filter((s) => !was.has(s)).sort(),
    resolve: [...was].filter((s) => !now.has(s)).sort(),
  };
}

/** Human summary of a rule for lists and notifications. */
export function describeAlertRule(rule: AlertRuleLike): string {
  const scope = rule.label ? `tunnel ${rule.label}` : "any tunnel";
  switch (rule.type) {
    case "TUNNEL_OFFLINE":
      return `${scope} offline for ${rule.windowMinutes ?? ALERT_DEFAULTS.TUNNEL_OFFLINE.windowMinutes} min`;
    case "ERROR_RATE":
      return `${scope}: ≥ ${rule.threshold ?? ALERT_DEFAULTS.ERROR_RATE.threshold}% server errors over ${rule.windowMinutes ?? ALERT_DEFAULTS.ERROR_RATE.windowMinutes} min (at least ${rule.minRequests ?? ALERT_DEFAULTS.ERROR_RATE.minRequests} requests)`;
    case "USAGE":
      return `monthly requests reach ${rule.threshold ?? ALERT_DEFAULTS.USAGE.threshold}% of the plan`;
    case "INBOX_FAILED":
      return `a webhook in ${rule.label ? `${rule.label}'s` : "any"} inbox fails for good`;
    case "DOMAIN":
      return "a custom domain is verified or stops pointing at us";
  }
}
