// packages/shared/src/teamSpace.ts
//
// Team space (internal-tools/shared/api-platform-plan.md, phase 6), the pure
// parts shared by the API routes and the realtime fan-out:
//
//   - mentions: <@userId> tokens in messages, comments, docs and issues;
//   - object references: dashboard links pasted into text become rich cards
//     (refFromUrl / refsInText), resolved by the API within the workspace;
//   - the tracker: statuses, priorities, the filter syntax of the issue list
//     ("status:todo assignee:me label:bug login"), board order (rankBetween);
//   - documents: the heading outline with anchors, and a line diff between
//     versions.

// ── Bounds and vocabularies ──────────────────────────────────────────────────

export const TEAM_BOUNDS = {
  messageLength: 8_000,
  channelName: 50,
  topicLength: 250,
  docTitle: 200,
  docBody: 1_000_000,
  folderName: 80,
  issueTitle: 200,
  issueBody: 50_000,
  commentLength: 8_000,
  labels: 10,
  labelLength: 30,
  refs: 5,
  reactionsPerMessage: 20,
  emojiLength: 32,
  dmMembers: 8,
} as const;

export const ISSUE_STATUSES = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const OPEN_STATUSES: readonly IssueStatus[] = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"];
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = { BACKLOG: "Backlog", TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" };

export const ISSUE_PRIORITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

// ── Names ────────────────────────────────────────────────────────────────────

export const CHANNEL_NAME_RE = /^[a-z0-9](?:[a-z0-9_-]{0,48}[a-z0-9])?$/;

/** "API Reviews!" -> "api-reviews". Empty when nothing usable is left. */
export function channelNameFrom(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, TEAM_BOUNDS.channelName)
    .replace(/[-_]+$/, "");
}

export function channelNameProblem(name: string): string | null {
  if (!name) return "Give the channel a name";
  if (!CHANNEL_NAME_RE.test(name)) return "Use 1–50 lowercase letters, digits, dashes and underscores";
  return null;
}

export function labelProblem(labels: readonly string[]): string | null {
  if (labels.length > TEAM_BOUNDS.labels) return `At most ${TEAM_BOUNDS.labels} labels`;
  for (const l of labels) if (!l.trim() || l.length > TEAM_BOUNDS.labelLength) return `Labels are 1–${TEAM_BOUNDS.labelLength} characters`;
  return null;
}

/** Trimmed, lowercased, unique labels in the order given. */
export const normalizeLabels = (labels: readonly string[]) => [...new Set(labels.map((l) => l.trim().toLowerCase()).filter(Boolean))];

// ── Mentions ─────────────────────────────────────────────────────────────────

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MENTION_RE = new RegExp(`<@(${UUID})>`, "gi");

/** User ids mentioned as <@id>, unique, in order. */
export function mentionsOf(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()))];
}

/** Text for emails and notifications: <@id> becomes @Name (or @someone). */
export function plainText(text: string, names: Record<string, string> = {}): string {
  return text.replace(MENTION_RE, (_, id: string) => `@${names[id.toLowerCase()] ?? "someone"}`);
}

// ── Object references (rich cards) ───────────────────────────────────────────

export type TeamRefKind =
  | "mock"
  | "mockEndpoint"
  | "collection"
  | "request"
  | "inspector"
  | "loadTest"
  | "monitor"
  | "spec"
  | "specOperation"
  | "doc"
  | "issue"
  | "channel";

export interface TeamRef {
  kind: TeamRefKind;
  accountId: string;
  /** The object's id (an issue's number as text). */
  id: string;
  /** Endpoint id, request id, operation anchor, doc heading anchor, inspector label. */
  sub?: string;
  /** The link as written, for display when it can't be resolved. */
  url: string;
}

const uuidRe = new RegExp(`^${UUID}$`, "i");
const isId = (s: string | null | undefined): s is string => !!s && uuidRe.test(s);

/**
 * A dashboard link (absolute or a path, with or without a locale prefix) as
 * an object reference, or null. Only links into a workspace count:
 * /organizations/<accountId>/<area>/...
 */
export function refFromUrl(raw: string): TeamRef | null {
  let u: URL;
  try {
    u = new URL(raw, "https://app.invalid");
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  const at = parts.indexOf("organizations");
  if (at < 0 || at > 1) return null;
  const accountId = parts[at + 1];
  if (!isId(accountId)) return null;
  const [area, a, b] = parts.slice(at + 2);
  const q = u.searchParams;
  const hash = decodeURIComponent(u.hash.replace(/^#/, ""));
  const ref = (kind: TeamRefKind, id: string, sub?: string): TeamRef => ({ kind, accountId: accountId.toLowerCase(), id, ...(sub ? { sub } : {}), url: raw });
  switch (area) {
    case "mocks":
      if (!isId(a)) return null;
      return q.get("endpoint") ? ref("mockEndpoint", a, q.get("endpoint")!.slice(0, 80)) : ref("mock", a);
    case "api-client":
      if (!isId(a)) return null;
      return q.get("request") ? ref("request", a, q.get("request")!.slice(0, 80)) : ref("collection", a);
    case "inspector": {
      const id = q.get("request");
      const label = q.get("label");
      return id && label ? ref("inspector", id.slice(0, 80), label.slice(0, 63)) : null;
    }
    case "performance":
      if (isId(q.get("run"))) return ref("loadTest", q.get("run")!);
      if (isId(q.get("monitor"))) return ref("monitor", q.get("monitor")!);
      return null;
    case "api-docs":
      if (!isId(a)) return null;
      return hash ? ref("specOperation", a, hash.slice(0, 120)) : ref("spec", a);
    case "team":
      if (a === "docs" && isId(b)) return ref("doc", b, hash ? hash.slice(0, 120) : undefined);
      if (a === "issues" && b && /^\d{1,9}$/.test(b)) return ref("issue", b);
      if (a === "chat" && isId(q.get("c"))) return ref("channel", q.get("c")!);
      return null;
    default:
      return null;
  }
}

const URL_RE = /(?:https?:\/\/[^\s<>()]+|(?<![\w/])\/(?:[a-z]{2}\/)?organizations\/[^\s<>()]+)/gi;

/** References in text (dashboard links), unique by kind+id+sub, at most `max` (messages: TEAM_BOUNDS.refs). */
export function refsInText(text: string, accountId?: string, max: number = TEAM_BOUNDS.refs): TeamRef[] {
  const out: TeamRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const r = refFromUrl(m[0].replace(/[.,;:!?]+$/, ""));
    if (!r || (accountId && r.accountId !== accountId.toLowerCase())) continue;
    const key = `${r.kind}|${r.id}|${r.sub ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** The dashboard path a reference opens. */
export function refPath(r: Pick<TeamRef, "kind" | "accountId" | "id" | "sub">): string {
  const base = `/organizations/${r.accountId}`;
  const enc = encodeURIComponent;
  switch (r.kind) {
    case "mock":
      return `${base}/mocks/${r.id}`;
    case "mockEndpoint":
      return `${base}/mocks/${r.id}?endpoint=${enc(r.sub ?? "")}`;
    case "collection":
      return `${base}/api-client/${r.id}`;
    case "request":
      return `${base}/api-client/${r.id}?request=${enc(r.sub ?? "")}`;
    case "inspector":
      return `${base}/inspector?label=${enc(r.sub ?? "")}&request=${enc(r.id)}`;
    case "loadTest":
      return `${base}/performance?tab=load&run=${r.id}`;
    case "monitor":
      return `${base}/performance?tab=monitors&monitor=${r.id}`;
    case "spec":
      return `${base}/api-docs/${r.id}?tab=preview`;
    case "specOperation":
      return `${base}/api-docs/${r.id}?tab=preview#${enc(r.sub ?? "")}`;
    case "doc":
      return `${base}/team/docs/${r.id}${r.sub ? `#${enc(r.sub)}` : ""}`;
    case "issue":
      return `${base}/team/issues/${r.id}`;
    case "channel":
      return `${base}/team/chat?c=${r.id}`;
  }
}

// ── Tracker ──────────────────────────────────────────────────────────────────

export interface IssueQuery {
  text: string;
  status: IssueStatus[];
  /** "me" | "none" | a user id */
  assignee: string | null;
  labels: string[];
  priority: IssuePriority[];
  /** overdue | today | week | none */
  due: "overdue" | "today" | "week" | "none" | null;
  /** open | closed | all (default open unless a status is given) */
  state: "open" | "closed" | "all";
}

const STATUS_ALIASES: Record<string, IssueStatus> = {
  backlog: "BACKLOG",
  todo: "TODO",
  "to-do": "TODO",
  progress: "IN_PROGRESS",
  "in-progress": "IN_PROGRESS",
  doing: "IN_PROGRESS",
  review: "IN_REVIEW",
  "in-review": "IN_REVIEW",
  done: "DONE",
  closed: "DONE",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
};

/**
 * "status:todo,doing assignee:me label:bug priority:high due:overdue login
 * page" -> filters + free text. Unknown keys stay in the text.
 */
export function parseIssueQuery(input: string): IssueQuery {
  const q: IssueQuery = { text: "", status: [], assignee: null, labels: [], priority: [], due: null, state: "open" };
  const words: string[] = [];
  let explicitState = false;
  for (const token of input.match(/(?:[^\s"]+:"[^"]*"|"[^"]*"|\S+)/g) ?? []) {
    const m = /^([a-z]+):(.+)$/i.exec(token);
    const key = m?.[1].toLowerCase();
    const values = (m?.[2] ?? "").replace(/^"|"$/g, "").split(",").map((v) => v.trim()).filter(Boolean);
    if (key === "status" || key === "is") {
      for (const v of values) {
        const lower = v.toLowerCase();
        if (lower === "open" || lower === "closed" || lower === "all") {
          q.state = lower;
          explicitState = true;
        } else if (STATUS_ALIASES[lower] ?? (ISSUE_STATUSES as readonly string[]).includes(v.toUpperCase())) q.status.push(STATUS_ALIASES[lower] ?? (v.toUpperCase() as IssueStatus));
      }
    } else if (key === "assignee") q.assignee = values[0] === "none" || values[0] === "me" ? values[0] : (values[0] ?? null);
    else if (key === "label") q.labels.push(...values.map((v) => v.toLowerCase()));
    else if (key === "priority") {
      for (const v of values) if ((ISSUE_PRIORITIES as readonly string[]).includes(v.toUpperCase())) q.priority.push(v.toUpperCase() as IssuePriority);
    } else if (key === "due" && ["overdue", "today", "week", "none"].includes(values[0] ?? "")) q.due = values[0] as IssueQuery["due"];
    else words.push(token.replace(/^"|"$/g, ""));
  }
  q.status = [...new Set(q.status)];
  q.labels = [...new Set(q.labels)];
  q.priority = [...new Set(q.priority)];
  if (q.status.length && !explicitState) q.state = "all";
  q.text = words.join(" ").trim();
  return q;
}

/** The statuses a query matches (status list, else the open/closed state). */
export function statusesFor(q: Pick<IssueQuery, "status" | "state">): IssueStatus[] {
  if (q.status.length) return q.status;
  if (q.state === "open") return [...OPEN_STATUSES];
  if (q.state === "closed") return ["DONE", "CANCELLED"];
  return [...ISSUE_STATUSES];
}

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * A string that sorts strictly between a and b (keys it makes never end in
 * "0", so there is always room after them) (either may be missing), for
 * board order without renumbering: dragging a card writes one row.
 */
export function rankBetween(a: string | null | undefined, b: string | null | undefined): string {
  const lo = a ?? "";
  const hi = b ?? "";
  if (a != null && b != null && lo >= hi) throw new Error("rankBetween: a must sort before b");
  let out = "";
  for (let i = 0; ; i++) {
    const x = i < lo.length ? DIGITS.indexOf(lo[i]) : 0;
    const y = b == null || i >= hi.length ? DIGITS.length : DIGITS.indexOf(hi[i]);
    if (x === y) {
      out += DIGITS[x];
      continue;
    }
    const mid = Math.floor((x + y) / 2);
    if (mid > x) return out + DIGITS[mid];
    // Adjacent digits: keep x and find room after it (below hi is now guaranteed).
    out += DIGITS[x];
    const rest = lo.slice(i + 1);
    for (let j = 0; ; j++) {
      const c = j < rest.length ? DIGITS.indexOf(rest[j]) : 0;
      if (c < DIGITS.length - 1) {
        const m = Math.floor((c + DIGITS.length) / 2);
        if (m > c) return out + DIGITS[m];
      }
      out += DIGITS[c];
    }
  }
}

// ── Documents ────────────────────────────────────────────────────────────────

/** GitHub-style heading anchor: lowercase, spaces to dashes, punctuation dropped. */
export function headingAnchor(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~[\]()]/g, "")
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s/g, "-") || "section"
  );
}

export interface OutlineEntry {
  level: number;
  text: string;
  anchor: string;
  line: number;
}

/** Headings (# to ######) outside code fences, with unique anchors (-1, -2 for repeats). */
export function docOutline(markdown: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const used = new Map<string, number>();
  let fence: string | null = null;
  markdown.split("\n").forEach((line, i) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const h = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) return;
    const text = h[2].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").trim();
    const base = headingAnchor(text);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    out.push({ level: h[1].length, text, anchor: n ? `${base}-${n}` : base, line: i + 1 });
  });
  return out;
}

export type DiffLine = { op: " " | "+" | "-"; text: string };

/**
 * Line diff (Myers). Falls back to "all removed, all added" when the edit is
 * too big to be worth a minimal diff (more than maxEdits changed lines).
 */
export function diffLines(a: string, b: string, maxEdits = 4_000): DiffLine[] {
  const x = a.length ? a.split("\n") : [];
  const y = b.length ? b.split("\n") : [];
  // Common prefix/suffix first: most edits touch a few lines of a long doc.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const head: DiffLine[] = x.slice(0, start).map((text) => ({ op: " ", text }));
  const tail: DiffLine[] = x.slice(endX).map((text) => ({ op: " ", text }));
  const xs = x.slice(start, endX);
  const ys = y.slice(start, endY);
  const n = xs.length;
  const m = ys.length;
  const max = n + m;
  if (!max) return [...head, ...tail];
  const fallback = (): DiffLine[] => [...head, ...xs.map((text) => ({ op: "-" as const, text })), ...ys.map((text) => ({ op: "+" as const, text })), ...tail];
  if (max > maxEdits * 50) return fallback();
  const v = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];
  let found = false;
  for (let d = 0; d <= Math.min(max, maxEdits) && !found; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let px = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let py = px - k;
      while (px < n && py < m && xs[px] === ys[py]) {
        px++;
        py++;
      }
      v.set(k, px);
      if (px >= n && py >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return fallback();
  // Walk back through the trace.
  const middle: DiffLine[] = [];
  let px = n;
  let py = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = px - py;
    const prevK = k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (px > prevX && py > prevY) {
      middle.push({ op: " ", text: xs[px - 1] });
      px--;
      py--;
    }
    if (d > 0) {
      if (px === prevX) middle.push({ op: "+", text: ys[py - 1] });
      else middle.push({ op: "-", text: xs[px - 1] });
    }
    px = prevX;
    py = prevY;
  }
  return [...head, ...middle.reverse(), ...tail];
}

export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((l) => l.op === "+").length, removed: lines.filter((l) => l.op === "-").length };
}

/** A short excerpt of text around the first match of q (for search results). */
export function excerpt(text: string, q: string, width = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = q ? flat.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
  const from = Math.max(0, i - Math.floor(width / 3));
  const to = Math.min(flat.length, from + width);
  return `${from > 0 ? "…" : ""}${flat.slice(from, to)}${to < flat.length ? "…" : ""}`;
}

// ── Realtime ─────────────────────────────────────────────────────────────────

export const TEAM_EVENT_KINDS = ["message", "message.edited", "message.deleted", "reaction", "channel", "channel.deleted", "read", "typing", "doc", "issue"] as const;
export type TeamEventKind = (typeof TEAM_EVENT_KINDS)[number];

/** Who may receive an event: everyone in the workspace, or only these users (private channels, DMs, own read state). */
export function eventVisibleTo(event: { userIds: readonly string[] }, userId: string): boolean {
  return event.userIds.length === 0 || event.userIds.includes(userId);
}
