// The team space engine (packages/shared/src/teamSpace.ts).
import { describe, expect, it } from "vitest";

import {
  channelNameFrom,
  channelNameProblem,
  diffLines,
  diffStats,
  docOutline,
  eventVisibleTo,
  excerpt,
  headingAnchor,
  labelProblem,
  mentionsOf,
  normalizeLabels,
  parseIssueQuery,
  plainText,
  rankBetween,
  refFromUrl,
  refPath,
  refsInText,
  statusesFor,
} from "@vhyxvoid/shared";

const A = "11111111-2222-4333-8444-555555555555";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U = "99999999-8888-4777-8666-555555555555";

describe("names and labels", () => {
  it("channel names", () => {
    expect(channelNameFrom("  API Reviews!! ")).toBe("api-reviews");
    expect(channelNameFrom("___")).toBe("");
    expect(channelNameProblem("api-reviews")).toBeNull();
    expect(channelNameProblem("API")).toMatch(/lowercase/);
    expect(channelNameProblem("")).toMatch(/name/);
  });

  it("labels", () => {
    expect(normalizeLabels([" Bug", "bug", "API ", ""])).toEqual(["bug", "api"]);
    expect(labelProblem(Array.from({ length: 11 }, (_, i) => `l${i}`))).toMatch(/At most/);
    expect(labelProblem(["x".repeat(31)])).toMatch(/characters/);
    expect(labelProblem(["ok"])).toBeNull();
  });
});

describe("mentions", () => {
  it("finds unique mentions and renders them as names", () => {
    const text = `hey <@${U}> and <@${A.toUpperCase()}>, also <@${U}> and <@not-a-uuid>`;
    expect(mentionsOf(text)).toEqual([U, A]);
    expect(plainText(text, { [U]: "Ada" })).toBe("hey @Ada and @someone, also @Ada and <@not-a-uuid>");
  });
});

describe("object references", () => {
  it("recognises dashboard links, with or without origin and locale", () => {
    expect(refFromUrl(`https://app.vhyxvoid.com/organizations/${A}/mocks/${B}?endpoint=e1`)).toMatchObject({ kind: "mockEndpoint", accountId: A, id: B, sub: "e1" });
    expect(refFromUrl(`/fr/organizations/${A}/mocks/${B}`)).toMatchObject({ kind: "mock", id: B });
    expect(refFromUrl(`/organizations/${A}/api-client/${B}?request=q7`)).toMatchObject({ kind: "request", sub: "q7" });
    expect(refFromUrl(`/organizations/${A}/inspector?label=app&request=r-123`)).toMatchObject({ kind: "inspector", id: "r-123", sub: "app" });
    expect(refFromUrl(`/organizations/${A}/performance?tab=load&run=${B}`)).toMatchObject({ kind: "loadTest", id: B });
    expect(refFromUrl(`/organizations/${A}/performance?tab=monitors&monitor=${B}`)).toMatchObject({ kind: "monitor", id: B });
    expect(refFromUrl(`/organizations/${A}/api-docs/${B}#get-users-id`)).toMatchObject({ kind: "specOperation", sub: "get-users-id" });
    expect(refFromUrl(`/organizations/${A}/team/docs/${B}#setup`)).toMatchObject({ kind: "doc", sub: "setup" });
    expect(refFromUrl(`/organizations/${A}/team/issues/42`)).toMatchObject({ kind: "issue", id: "42" });
    expect(refFromUrl(`/organizations/${A}/team/chat?c=${B}`)).toMatchObject({ kind: "channel", id: B });
    for (const bad of ["https://example.com/", `/organizations/nope/mocks/${B}`, `/organizations/${A}/billing`, `/organizations/${A}/mocks/x`, `/a/b/organizations/${A}/mocks/${B}`]) expect(refFromUrl(bad), bad).toBeNull();
  });

  it("collects up to five unique references from text, only for the workspace", () => {
    const text = [
      `see https://app.vhyxvoid.com/organizations/${A}/mocks/${B}.`,
      `and again /organizations/${A}/mocks/${B}, plus /organizations/${A}/team/issues/7`,
      `other workspace /organizations/${U}/mocks/${B}`,
      ...[1, 2, 3, 4, 5].map((n) => `/organizations/${A}/team/issues/${n}`),
    ].join(" ");
    const refs = refsInText(text, A);
    expect(refs.map((r) => `${r.kind}:${r.id}`)).toEqual([`mock:${B}`, "issue:7", "issue:1", "issue:2", "issue:3"]);
    expect(refs[0].url).toBe(`https://app.vhyxvoid.com/organizations/${A}/mocks/${B}`);
  });

  it("paths round-trip through refFromUrl", () => {
    for (const r of [
      { kind: "mockEndpoint", accountId: A, id: B, sub: "e 1" },
      { kind: "request", accountId: A, id: B, sub: "q1" },
      { kind: "inspector", accountId: A, id: "r1", sub: "app" },
      { kind: "loadTest", accountId: A, id: B },
      { kind: "specOperation", accountId: A, id: B, sub: "get-users" },
      { kind: "doc", accountId: A, id: B, sub: "intro" },
      { kind: "issue", accountId: A, id: "12" },
      { kind: "channel", accountId: A, id: B },
    ] as const) {
      expect(refFromUrl(refPath(r)), r.kind).toMatchObject(r);
    }
  });
});

describe("tracker", () => {
  it("parses the filter syntax", () => {
    const q = parseIssueQuery('status:todo,doing assignee:me label:Bug,api priority:high,bogus due:overdue login "page broken" color:red');
    expect(q).toEqual({ text: 'login page broken color:red', status: ["TODO", "IN_PROGRESS"], assignee: "me", labels: ["bug", "api"], priority: ["HIGH"], due: "overdue", state: "all" });
    expect(parseIssueQuery("crash")).toMatchObject({ text: "crash", state: "open", status: [] });
    expect(parseIssueQuery("is:closed")).toMatchObject({ state: "closed" });
    expect(statusesFor(parseIssueQuery(""))).toEqual(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"]);
    expect(statusesFor(parseIssueQuery("is:closed"))).toEqual(["DONE", "CANCELLED"]);
    expect(statusesFor(parseIssueQuery("status:done"))).toEqual(["DONE"]);
  });

  it("ranks always fit between neighbours", () => {
    expect(rankBetween(null, null) > "").toBe(true);
    const ranks = [rankBetween(null, null)];
    // Insert at the end, the start and the middle many times; order must hold.
    for (let i = 0; i < 200; i++) {
      const sorted = [...ranks].sort();
      const pick = i % 3;
      const r = pick === 0 ? rankBetween(sorted[sorted.length - 1], null) : pick === 1 ? rankBetween(null, sorted[0]) : rankBetween(sorted[0], sorted[1] ?? null);
      expect(sorted.includes(r), r).toBe(false);
      ranks.push(r);
    }
    const sorted = [...ranks].sort();
    expect(new Set(sorted).size).toBe(ranks.length);
    // Repeatedly between two adjacent keys.
    let lo = "a";
    const hi = "b";
    for (let i = 0; i < 50; i++) {
      const r = rankBetween(lo, hi);
      expect(r > lo && r < hi, `${lo} < ${r} < ${hi}`).toBe(true);
      lo = r;
    }
    expect(ranks.every((r) => !r.endsWith("0"))).toBe(true);
    expect(rankBetween("a", "a1") > "a" && rankBetween("a", "a1") < "a1").toBe(true);
    expect(() => rankBetween("b", "a")).toThrow();
  });
});

describe("documents", () => {
  it("outlines headings outside code, with unique anchors", () => {
    const md = ["# Setup guide", "text", "## Install `vv`", "```bash", "# not a heading", "```", "## Install `vv`", "### [Links](http://x) & *more*", "#hashtag"].join("\n");
    expect(docOutline(md)).toEqual([
      { level: 1, text: "Setup guide", anchor: "setup-guide", line: 1 },
      { level: 2, text: "Install vv", anchor: "install-vv", line: 3 },
      { level: 2, text: "Install vv", anchor: "install-vv-1", line: 7 },
      { level: 3, text: "Links & more", anchor: "links--more", line: 8 },
    ]);
    expect(headingAnchor("Café: déjà vu?")).toBe("café-déjà-vu");
  });

  it("diffs lines minimally", () => {
    const a = "one\ntwo\nthree\nfour";
    const b = "one\n2\nthree\nfour\nfive";
    const d = diffLines(a, b);
    expect(d).toEqual([
      { op: " ", text: "one" },
      { op: "-", text: "two" },
      { op: "+", text: "2" },
      { op: " ", text: "three" },
      { op: " ", text: "four" },
      { op: "+", text: "five" },
    ]);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
    expect(diffLines("same", "same")).toEqual([{ op: " ", text: "same" }]);
    expect(diffLines("", "new")).toEqual([{ op: "+", text: "new" }]);
    // Reconstructs both sides for random edits.
    const big = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const edited = big.filter((_, i) => i % 7 !== 0).map((l, i) => (i % 11 === 0 ? `${l} (edited)` : l));
    const dd = diffLines(big.join("\n"), edited.join("\n"));
    expect(dd.filter((l) => l.op !== "+").map((l) => l.text)).toEqual(big);
    expect(dd.filter((l) => l.op !== "-").map((l) => l.text)).toEqual(edited);
  });

  it("excerpts around a match", () => {
    const text = `${"a ".repeat(100)}needle ${"b ".repeat(100)}`;
    const e = excerpt(text, "NEEDLE", 40);
    expect(e).toContain("needle");
    expect(e.startsWith("…") && e.endsWith("…")).toBe(true);
    expect(excerpt("short", "x")).toBe("short");
  });
});

describe("realtime audience", () => {
  it("empty audience = whole workspace", () => {
    expect(eventVisibleTo({ userIds: [] }, U)).toBe(true);
    expect(eventVisibleTo({ userIds: [A] }, U)).toBe(false);
    expect(eventVisibleTo({ userIds: [A, U] }, U)).toBe(true);
  });
});
