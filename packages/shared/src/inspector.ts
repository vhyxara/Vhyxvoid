// packages/shared/src/inspector.ts
//
// Request inspector: the hub keeps the most recent requests of each public
// tunnel (method, path, headers, a bounded slice of each body, the response)
// so a developer can see what a webhook provider actually sent and replay
// it. apps/hub writes, apps/api reads; both go through these helpers so the
// Redis layout and the privacy rules live in one place.
//
// Privacy and cost rules:
//   - Credentials are never stored: values of MASKED_HEADERS are replaced.
//   - Bodies are cut at INSPECT_BODY_MAX_BYTES each.
//   - Every list expires INSPECT_TTL_SECONDS after its last write.
//   - How many requests are kept per tunnel is the plan limit
//     `inspectorRequests` (0 turns capture off), set by admins.
//   - One pipelined Redis call per captured request.

export const INSPECT_BODY_MAX_BYTES = 16 * 1024;
export const INSPECT_TTL_SECONDS = 24 * 60 * 60;

/** Header values never written to the inspector. Replays are sent without them. */
export const MASKED_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
  "x-xsrf-token",
]);

export const MASK = "[hidden]";

export interface InspectedBody {
  /** utf8 text, or base64 for binary content. Null when there was no body. */
  data: string | null;
  encoding: "utf8" | "base64" | null;
  /** Size of the whole body in bytes (before truncation). */
  size: number;
  truncated: boolean;
}

export interface InspectedRequest {
  /** The hub's request id (req_…). */
  id: string;
  /** ISO time the request reached the hub. */
  at: string;
  label: string;
  accountSlug: string;
  /** The public hostname the request was sent to. */
  host: string;
  method: string;
  path: string;
  clientIp: string | null;
  request: { headers: Record<string, string>; body: InspectedBody };
  /** Null when the agent never answered. */
  response: { status: number; headers: Record<string, string>; body: InspectedBody; streamed: boolean } | null;
  durationMs: number | null;
  /** AGENT_TIMEOUT, BACKEND_UNREACHABLE, … when the request failed. */
  error: string | null;
  /** Set on a request created by "Replay": the id it replays. */
  replayOf: string | null;
}

export const inspectorKeys = {
  /** Newest-first list of JSON entries for one tunnel. */
  list: (accountId: string, label: string) => `insp:v1:${accountId}:${label}`,
  /** Hash label -> ISO time of the last capture, for the tunnel picker. */
  labels: (accountId: string) => `insp:v1:labels:${accountId}`,
};

/** Copy headers with credentials masked. */
export function maskHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    out[lower] = MASKED_HEADERS.has(lower) ? MASK : Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

/** Headers safe to send again on replay: masked ones and hop-by-hop ones dropped. */
export function replayableHeaders(headers: Record<string, string>): Record<string, string> {
  const drop = new Set(["host", "content-length", "connection", "transfer-encoding", "keep-alive", "upgrade", "x-forwarded-for", "x-real-ip"]);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === MASK || MASKED_HEADERS.has(name) || drop.has(name)) continue;
    out[name] = value;
  }
  return out;
}

/** A bounded copy of a body for the inspector. */
export function captureBody(body: Buffer | null | undefined, binary: boolean): InspectedBody {
  if (!body || body.length === 0) return { data: null, encoding: null, size: 0, truncated: false };
  const slice = body.length > INSPECT_BODY_MAX_BYTES ? body.subarray(0, INSPECT_BODY_MAX_BYTES) : body;
  return {
    data: slice.toString(binary ? "base64" : "utf8"),
    encoding: binary ? "base64" : "utf8",
    size: body.length,
    truncated: body.length > INSPECT_BODY_MAX_BYTES,
  };
}

/** True for content types whose bodies must be kept as base64. */
export function isBinaryForInspector(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return !(
    ct.startsWith("text/") ||
    ct.includes("json") ||
    ct.includes("xml") ||
    ct.includes("javascript") ||
    ct.includes("x-www-form-urlencoded") ||
    ct.includes("graphql") ||
    ct.includes("yaml") ||
    ct.includes("csv")
  );
}

/** Minimal Upstash-style client: what the hub needs to write a capture. */
export interface InspectorRedisWriter {
  pipeline(): {
    lpush(key: string, value: string): unknown;
    ltrim(key: string, start: number, stop: number): unknown;
    expire(key: string, seconds: number): unknown;
    hset(key: string, values: Record<string, string>): unknown;
    exec(): Promise<unknown>;
  };
}

export async function writeInspectedRequest(
  redis: InspectorRedisWriter,
  accountId: string,
  entry: InspectedRequest,
  keep: number,
): Promise<void> {
  if (keep <= 0) return;
  const list = inspectorKeys.list(accountId, entry.label);
  const labels = inspectorKeys.labels(accountId);
  const p = redis.pipeline();
  p.lpush(list, JSON.stringify(entry));
  p.ltrim(list, 0, keep - 1);
  p.expire(list, INSPECT_TTL_SECONDS);
  p.hset(labels, { [entry.label]: entry.at });
  p.expire(labels, INSPECT_TTL_SECONDS);
  await p.exec();
}

/** Parse stored entries, skipping anything malformed. */
export function parseInspectedRequests(raw: unknown[]): InspectedRequest[] {
  const out: InspectedRequest[] = [];
  for (const item of raw) {
    try {
      const v = typeof item === "string" ? JSON.parse(item) : item;
      if (v && typeof v === "object" && typeof (v as InspectedRequest).id === "string") out.push(v as InspectedRequest);
    } catch {
      // skip
    }
  }
  return out;
}
