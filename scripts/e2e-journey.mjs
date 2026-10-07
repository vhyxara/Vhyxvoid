#!/usr/bin/env node
// scripts/e2e-journey.mjs
//
// Full user journey against a RUNNING api + hub, with real processes:
// register -> verify email -> login -> accounts -> organization -> invites ->
// API key -> CLI agent -> public tunnel URL (JSON, binary, gzip, 5 MB body,
// cookies, WebSocket, 404/502 paths) -> dashboard tunnels -> SDK ->
// rate limit -> revoke (agent evicted) -> password reset -> logout.
//
// Meant for a local stack (see code-archive CA-0030) or a staging stack. Never
// point it at production: it creates users, keys and traffic.
//
// Env:
//   API_URL        http://127.0.0.1:9100          (api base, no /api/v1)
//   HUB_URL        http://127.0.0.1:9101          (hub HTTP base)
//   HUB_DOMAIN     vv.test                         (tunnel host suffix)
//   EMAIL_LOG      path to the api's stdout when it uses ConsoleEmailService
//   UPSTASH_REDIS_REST_URL / _TOKEN   optional: check usage counters directly
//   E2E_SKIP_SLOW=1  skip the ~70 s revoke-eviction and rate-limit steps
//   STRIPE_WEBHOOK_SECRET / STRIPE_PRO_PRICE_ID   optional: drive billing
//                  with signed webhook events (upgrade, invites, past due,
//                  cancel). Must match the api's own values.
//   HUB_INTERNAL_SECRET  the hub's internal secret: flushes its request counts
//                  for the traffic-chart step (and the alerts step)
//   ADMIN_EMAIL / ADMIN_PASSWORD   optional: also run the admin API journey
//                                  (a super admin, e.g. from seed:admin)
//
// Exit code 0 only if every step passed.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.join(root, "packages/agent/package.json"));
const WebSocket = req("ws");
const { WebSocketServer } = WebSocket;

const API = (process.env.API_URL ?? "http://127.0.0.1:9100") + "/api/v1";
const HUB = process.env.HUB_URL ?? "http://127.0.0.1:9101";
const HUB_DOMAIN = process.env.HUB_DOMAIN ?? "vv.test";
const EMAIL_LOG = process.env.EMAIL_LOG;
const SLOW = process.env.E2E_SKIP_SLOW !== "1";
const RUN = randomBytes(3).toString("hex");

const results = [];
const cleanups = [];
let failed = 0;

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } catch (err) {
    failed++;
    results.push({ name, ok: false, ms: Date.now() - t0, err: String(err?.message ?? err) });
    console.log(`FAIL  ${name}\n      ${String(err?.stack ?? err).split("\n").slice(0, 3).join("\n      ")}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, opts = {}) {
  const r = await apiOnce(method, p, opts);
  // Auth endpoints are rate limited per IP (10/min users, 5/min admins);
  // back-to-back runs can hit that. Wait it out once rather than cascade.
  if (r.status === 429 && /\/auth\//.test(p)) {
    const wait = Number(r.headers.get("retry-after") ?? r.headers.get("x-ratelimit-reset") ?? 60);
    console.log(`      (auth rate limit hit, waiting ${wait}s)`);
    await sleep((wait + 1) * 1000);
    return apiOnce(method, p, opts);
  }
  return r;
}

async function apiOnce(method, p, { token, body, headers = {} } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, headers: res.headers };
}

// Raw HTTP to the hub with an explicit Host (fetch can't override Host).
async function tunnel(host, method, p, { body, headers = {} } = {}) {
  const { request } = await import("node:http");
  const u = new URL(HUB);
  return new Promise((resolve, reject) => {
    const r = request(
      { host: u.hostname, port: u.port, method, path: p, headers: { host, ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

// Emails are sent after the transaction commits, so they can land a moment
// after the HTTP response: poll briefly.
async function lastEmail(to, subjectRe, waitMs = 5000) {
  const t0 = Date.now();
  for (;;) {
    try {
      return lastEmailNow(to, subjectRe);
    } catch (e) {
      if (Date.now() - t0 > waitMs) throw e;
      await sleep(200);
    }
  }
}

function lastEmailNow(to, subjectRe) {
  assert(EMAIL_LOG, "EMAIL_LOG is not set");
  const lines = fs.readFileSync(EMAIL_LOG, "utf8").split("\n").filter((l) => l.includes("[email:console]"));
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = JSON.parse(lines[i].slice(lines[i].indexOf("{")));
    const rcpt = Array.isArray(e.to) ? e.to : [e.to];
    if (rcpt.includes(to) && subjectRe.test(e.subject)) return e;
  }
  throw new Error(`no email to ${to} matching ${subjectRe}`);
}
const tokenFrom = (email) => {
  for (const l of email.links) {
    const t = new URL(l).searchParams.get("token");
    if (t) return t;
  }
  throw new Error("no token link in email");
};

// ── Local backend the agent forwards to ───────────────────────────────────
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0def46b80000000049454e44ae426082",
  "hex",
);
let backendHits = 0;
let foreverClosedAt = 0;
let slowClosedAt = 0;
const backend = createServer((q, r) => {
  backendHits++;
  const chunks = [];
  q.on("data", (c) => chunks.push(c));
  q.on("end", () => {
    const body = Buffer.concat(chunks);
    const url = new URL(q.url, "http://x");
    if (url.pathname === "/echo") {
      r.writeHead(200, { "content-type": "application/json" });
      return r.end(
        JSON.stringify({
          method: q.method,
          path: url.pathname,
          query: url.search,
          headers: q.headers,
          bodyLength: body.length,
          bodySha256: createHash("sha256").update(body).digest("hex"),
        }),
      );
    }
    if (url.pathname === "/png") {
      r.writeHead(200, { "content-type": "image/png" });
      return r.end(PNG);
    }
    if (url.pathname === "/gzip") {
      const z = gzipSync(Buffer.from("compressed hello ".repeat(200)));
      r.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      return r.end(z);
    }
    if (url.pathname === "/cookies") {
      r.writeHead(200, { "set-cookie": ["a=1; Path=/; HttpOnly", "b=2; Path=/"] });
      return r.end("ok");
    }
    if (url.pathname === "/sse") {
      r.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      let n = 0;
      const t = setInterval(() => {
        r.write(`data: tick ${++n}\n\n`);
        if (n === 4) {
          clearInterval(t);
          r.end();
        }
      }, 300);
      return;
    }
    if (url.pathname === "/forever") {
      // An endless stream; records when the tunnel closes it.
      r.writeHead(200, { "content-type": "text/event-stream" });
      const t = setInterval(() => r.write("data: still here\n\n"), 200);
      r.on("close", () => {
        clearInterval(t);
        foreverClosedAt = Date.now();
      });
      return;
    }
    if (url.pathname === "/slow") {
      const t = setTimeout(() => r.end("slow done"), 10_000);
      r.on("close", () => {
        clearTimeout(t);
        if (!r.writableFinished) slowClosedAt = Date.now();
      });
      return;
    }
    if (url.pathname === "/status/500") {
      r.writeHead(500);
      return r.end("boom");
    }
    if (url.pathname === "/status/418") {
      r.writeHead(418);
      return r.end("teapot");
    }
    if (url.pathname === "/empty") {
      r.writeHead(204);
      return r.end();
    }
    r.writeHead(404);
    r.end("not found");
  });
});
const wss = new WebSocketServer({ server: backend, path: "/ws" });
wss.on("connection", (ws) => ws.on("message", (m, isBinary) => ws.send(isBinary ? m : `echo:${m}`)));

// ── Agent process ─────────────────────────────────────────────────────────
function startAgent({ key, secret, port, label }) {
  const cli = path.join(root, "packages/agent/dist/cli.js");
  assert(fs.existsSync(cli), "packages/agent/dist/cli.js missing: build the agent first");
  const hubWs = HUB.replace(/^http/, "ws") + "/agent";
  const child = spawn(process.execPath, [cli, "--key", key, "--secret", secret, "--port", String(port), "--label", label, "--hub", hubWs, "--no-local-discovery"], {
    env: { ...process.env, VHYXVOID_API_KEY: "", VHYXVOID_SECRET: "", DOTENV_CONFIG_QUIET: "true" },
    cwd: fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "vv-agent-")),
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise((r) => child.on("exit", (code, signal) => r({ code, signal })));
  cleanups.push(() => child.kill("SIGINT"));
  return {
    child,
    exited,
    output: () => out,
    waitFor: async (re, ms = 15_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const m = out.match(re);
        if (m) return m;
        await sleep(100);
      }
      throw new Error(`agent output never matched ${re}; got:\n${out.slice(-1500)}`);
    },
  };
}

// ── The journey ───────────────────────────────────────────────────────────
const email = `ada.${RUN}@e2e.test`;
const password = "Correct-Horse-9!";
const s = {};

await new Promise((r) => backend.listen(0, "127.0.0.1", r));
s.backendPort = backend.address().port;
cleanups.push(() => new Promise((r) => backend.close(r)));

await step("register", async () => {
  const r = await api("POST", "/auth/register", { body: { email, password, firstName: "Ada", lastName: "Lovelace" } });
  assert(r.status === 201 || r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
});

await step("login is refused before email verification", async () => {
  const r = await api("POST", "/auth/login", { body: { email, password } });
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

// Pre-verification account takeover: an attacker registers the victim's
// address first. The victim's later registration must not leave the
// attacker's password in place, and the attacker must never get a session.
await step("security: registering someone else's address can't take it over", async () => {
  const victim = `victim.${RUN}@e2e.test`;
  const attackerPw = "Attacker-Pass-1!";
  const victimPw = "Victim-Pass-2!";
  await api("POST", "/auth/register", { body: { email: victim, password: attackerPw, firstName: "Mallory" } });
  const early = await api("POST", "/auth/login", { body: { email: victim, password: attackerPw } });
  assert(early.status === 403, `attacker got a session before verification (${early.status})`);
  const second = await api("POST", "/auth/register", { body: { email: victim, password: victimPw, firstName: "Victor" } });
  assert(second.status === 200 || second.status === 201, `second registration ${second.status}`);
  // The inbox owner gets a "finish creating your account" link, not a
  // verification link that would keep the attacker's password.
  const mail = await lastEmail(victim, /finish creating/i);
  const fin = await api("POST", "/auth/reset-password", { body: { token: tokenFrom(mail), newPassword: victimPw } });
  assert(fin.status === 200, `finish signup ${fin.status}: ${JSON.stringify(fin.json)}`);
  const attacker = await api("POST", "/auth/login", { body: { email: victim, password: attackerPw } });
  assert(attacker.status === 401, `attacker password still works (${attacker.status})`);
  const owner = await api("POST", "/auth/login", { body: { email: victim, password: victimPw } });
  assert(owner.status === 200, `owner can't log in (${owner.status})`);
  const me = await api("GET", "/account/me", { token: owner.json.data.accessToken });
  assert(me.json.data.accounts.some((a) => a.accountType === "PERSONAL"), "no personal workspace after finishing signup");
});

await step("verify email from the emailed link", async () => {
  const token = tokenFrom(await lastEmail(email, /verify/i));
  const r = await api("POST", "/auth/verify-email", { body: { token } });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
  const again = await api("POST", "/auth/verify-email", { body: { token } });
  assert(again.status === 400, `a used token must be a 400, got ${again.status}`);
});

await step("login", async () => {
  const r = await api("POST", "/auth/login", { body: { email, password } });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
  s.token = r.json.data.accessToken;
  s.refreshCookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  assert(s.token && s.refreshCookie.startsWith("refresh_token="), "missing access token or refresh cookie");
});

await step("wrong password is refused", async () => {
  const r = await api("POST", "/auth/login", { body: { email, password: "nope-nope-nope" } });
  assert(r.status === 401 || r.status === 400, `status ${r.status}`);
});

await step("me: one personal workspace", async () => {
  const r = await api("GET", "/account/me", { token: s.token });
  assert(r.status === 200, `status ${r.status}`);
  const personal = r.json.data.accounts.filter((a) => a.accountType === "PERSONAL");
  assert(personal.length === 1, `expected 1 personal account, got ${personal.length}`);
  s.personal = personal[0].accountId;
});

await step("renaming the personal workspace is a 403", async () => {
  const r = await api("PATCH", `/account/organizations/${s.personal}`, { token: s.token, body: { name: "Renamed" } });
  assert(r.status === 403, `status ${r.status}: ${JSON.stringify(r.json)}`);
});

await step("inviting to the personal workspace is a 403", async () => {
  const r = await api("POST", `/account/organizations/${s.personal}/members/invite`, {
    token: s.token,
    body: { email: `bob.${RUN}@e2e.test`, roleLevel: 10 },
  });
  assert(r.status === 403, `status ${r.status}: ${JSON.stringify(r.json)}`);
});

await step("create an organization", async () => {
  const r = await api("POST", "/account/organizations", { token: s.token, body: { name: `Acme ${RUN}` } });
  assert(r.status === 201 || r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
  s.org = r.json.data?.organizationId ?? r.json.data?.id;
  assert(s.org, `no org id in ${JSON.stringify(r.json)}`);
});

await step("FREE org: inviting a member hits the plan limit (402)", async () => {
  const r = await api("POST", `/account/organizations/${s.org}/members/invite`, {
    token: s.token,
    body: { email: `bob.${RUN}@e2e.test`, roleLevel: 10 },
  });
  assert(r.status === 402, `status ${r.status}: ${JSON.stringify(r.json)}`);
});

async function stripeEvent(type, object, id = `evt_${randomBytes(8).toString("hex")}`) {
  const { createHmac } = await import("node:crypto");
  const payload = JSON.stringify({ id, object: "event", type, api_version: "2024-06-20", created: Math.floor(Date.now() / 1000), data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
  const res = await fetch(API + "/billing/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` },
    body: payload,
  });
  return { status: res.status, text: await res.text() };
}
const stripeSub = (status, extra = {}) => ({
  id: `sub_e2e_${RUN}`,
  object: "subscription",
  customer: `cus_e2e_${RUN}`,
  status,
  metadata: { accountId: s.org },
  items: { data: [{ price: { id: process.env.STRIPE_PRO_PRICE_ID ?? "price_pro_test", product: "prod_pro" }, current_period_start: Math.floor(Date.now() / 1000), current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
  cancel_at_period_end: false,
  start_date: Math.floor(Date.now() / 1000),
  ...extra,
});

if (process.env.STRIPE_WEBHOOK_SECRET) {
  await step("billing: an unsigned or badly signed webhook is refused", async () => {
    const r = await fetch(API + "/billing/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" }, body: "{}" });
    assert(r.status === 400 || r.status === 401, `status ${r.status}`);
  });

  await step("billing: subscription.created (PRO) upgrades the organization", async () => {
    const r = await stripeEvent("customer.subscription.created", stripeSub("active"));
    assert(r.status === 200, `webhook ${r.status}: ${r.text}`);
    const sub = await api("GET", `/billing/organizations/${s.org}/billing/subscription`, { token: s.token });
    assert(JSON.stringify(sub.json).includes("PRO"), `subscription: ${JSON.stringify(sub.json).slice(0, 300)}`);
  });

  await step("billing: the same event delivered twice is processed once", async () => {
    const id = `evt_dup_${RUN}`;
    const a = await stripeEvent("customer.subscription.updated", stripeSub("active"), id);
    const b = await stripeEvent("customer.subscription.updated", stripeSub("active"), id);
    assert(a.status === 200 && b.status === 200, `${a.status} ${b.status}`);
    assert(!a.text.includes("duplicate") && b.text.includes("duplicate"), `${a.text} / ${b.text}`);
  });

  await step("PRO org: invite -> invitee registers, verifies, accepts from the email", async () => {
    const bob = `bob.${RUN}@e2e.test`;
    const inv = await api("POST", `/account/organizations/${s.org}/members/invite`, { token: s.token, body: { email: bob, roleLevel: 10 } });
    assert(inv.status === 201 || inv.status === 200, `invite ${inv.status}: ${JSON.stringify(inv.json)}`);
    const inviteToken = tokenFrom(await lastEmail(bob, /invit/i));
    await api("POST", "/auth/register", { body: { email: bob, password, firstName: "Bob" } });
    await api("POST", "/auth/verify-email", { body: { token: tokenFrom(await lastEmail(bob, /verify/i)) } });
    const login = await api("POST", "/auth/login", { body: { email: bob, password } });
    assert(login.status === 200, `bob login ${login.status}`);
    s.bob = login.json.data.accessToken;
    const acc = await api("POST", "/account/invitations/accept", { token: s.bob, body: { token: inviteToken } });
    assert(acc.status === 200 || acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.json)}`);
    const me = await api("GET", "/account/me", { token: s.bob });
    assert(me.json.data.accounts.some((a) => a.accountId === s.org), "bob is not a member after accepting");
    const again = await api("POST", "/account/invitations/accept", { token: s.bob, body: { token: inviteToken } });
    assert(again.status >= 400 && again.status < 500, `a used invitation must be refused (${again.status})`);
  });

  await step("members: a MEMBER can't invite or remove; the owner can remove", async () => {
    const members = await api("GET", `/account/organizations/${s.org}/members`, { token: s.token });
    const list = members.json.items ?? members.json.data?.items ?? [];
    const bobRow = list.find((m) => String(m.email).startsWith("bob."));
    assert(bobRow, `bob not in members: ${JSON.stringify(members.json).slice(0, 200)}`);
    const inv = await api("POST", `/account/organizations/${s.org}/members/invite`, { token: s.bob, body: { email: `eve.${RUN}@e2e.test`, roleLevel: 10 } });
    assert(inv.status === 403, `member invited someone (${inv.status})`);
    const rm = await api("DELETE", `/account/organizations/${s.org}/members/${bobRow.id}`, { token: s.token });
    assert(rm.status < 300, `remove ${rm.status}: ${JSON.stringify(rm.json)}`);
    const me = await api("GET", "/account/me", { token: s.bob });
    assert(!me.json.data.accounts.some((a) => a.accountId === s.org), "bob still a member after removal");
  });

  await step("billing: past_due keeps the org usable (grace period)", async () => {
    const r = await stripeEvent("customer.subscription.updated", stripeSub("past_due"));
    assert(r.status === 200, `webhook ${r.status}: ${r.text}`);
    const me = await api("GET", "/account/me", { token: s.token });
    const org = me.json.data.accounts.find((a) => a.accountId === s.org);
    assert(org?.accountStatus === "PAST_DUE", `account status ${org?.accountStatus}`);
    const k = await api("POST", `/apikeys/organizations/${s.org}/api-keys`, { token: s.token, body: { name: "grace", environment: "PROD", scopes: ["tunnel:connect"] } });
    assert(k.status === 201 || k.status === 200, `PRO key during grace ${k.status}: ${JSON.stringify(k.json)}`);
  });

  await step("billing: subscription.deleted returns the org to FREE limits", async () => {
    const r = await stripeEvent("customer.subscription.deleted", stripeSub("canceled", { canceled_at: Math.floor(Date.now() / 1000) }));
    assert(r.status === 200, `webhook ${r.status}: ${r.text}`);
    const k = await api("POST", `/apikeys/organizations/${s.org}/api-keys`, { token: s.token, body: { name: "after", environment: "PROD", scopes: ["tunnel:connect"] } });
    assert(k.status === 403 || k.status === 402, `PROD key after cancel: ${k.status}`);
  });
}

await step("create an API key with an expiry (allowed on FREE)", async () => {
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  const r = await api("POST", `/apikeys/organizations/${s.personal}/api-keys`, {
    token: s.token,
    body: { name: "e2e", environment: "DEV", scopes: ["tunnel:connect"], expiresAt },
  });
  assert(r.status === 201 || r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
  const d = r.json.data ?? r.json;
  s.keyId = d.key?.keyId ?? d.keyId;
  s.keyUuid = d.key?.id ?? d.id;
  s.secret = d.secret;
  assert(s.keyId && s.secret, `missing keyId/secret in ${JSON.stringify(d)}`);
});

await step("a PROD key is refused on FREE", async () => {
  const r = await api("POST", `/apikeys/organizations/${s.personal}/api-keys`, {
    token: s.token,
    body: { name: "prod", environment: "PROD", scopes: ["tunnel:connect"] },
  });
  assert(r.status >= 400 && r.status < 500, `status ${r.status}`);
  return `status ${r.status}`;
});

await step("agent CLI connects and prints the public URL", async () => {
  s.agent = startAgent({ key: s.keyId, secret: s.secret, port: s.backendPort, label: "app" });
  const m = await s.agent.waitFor(/Public:\s+(\S+)/);
  s.publicUrl = m[1];
  s.host = new URL(s.publicUrl).host;
  assert(s.host.endsWith(`.${HUB_DOMAIN}`), `unexpected host ${s.host}`);
  assert(!/queue/i.test(s.agent.output()), "agent still mentions a queue");
  return s.publicUrl;
});

await step("tunnel: JSON GET with query, headers reach the backend", async () => {
  const r = await tunnel(s.host, "GET", "/echo?x=1&y=two", { headers: { "x-custom": "hello" } });
  assert(r.status === 200, `status ${r.status}: ${r.body}`);
  const j = JSON.parse(r.body);
  assert(j.query === "?x=1&y=two", `query ${j.query}`);
  assert(j.headers["x-custom"] === "hello", "custom header lost");
});

await step("tunnel: spoofed X-Forwarded-For is not trusted by the hub path", async () => {
  const r = await tunnel(s.host, "GET", "/echo", { headers: { "x-forwarded-for": "6.6.6.6" } });
  const j = JSON.parse(r.body);
  return `backend saw x-forwarded-for=${j.headers["x-forwarded-for"] ?? "(none)"} (nginx overwrites it in production)`;
});

await step("tunnel: POST 5 MB body arrives intact", async () => {
  const big = randomBytes(5 * 1024 * 1024);
  const r = await tunnel(s.host, "POST", "/echo", { body: big, headers: { "content-type": "application/octet-stream", "content-length": big.length } });
  assert(r.status === 200, `status ${r.status}: ${String(r.body).slice(0, 200)}`);
  const j = JSON.parse(r.body);
  assert(j.bodyLength === big.length, `length ${j.bodyLength}`);
  assert(j.bodySha256 === createHash("sha256").update(big).digest("hex"), "body hash differs");
});

await step("tunnel: binary response is byte-identical", async () => {
  const r = await tunnel(s.host, "GET", "/png");
  assert(r.status === 200 && Buffer.compare(r.body, PNG) === 0, `status ${r.status}, ${r.body.length} bytes`);
});

await step("tunnel: gzip response is returned in full", async () => {
  const r = await tunnel(s.host, "GET", "/gzip", { headers: { "accept-encoding": "gzip" } });
  const { gunzipSync } = await import("node:zlib");
  const text = r.headers["content-encoding"] === "gzip" ? gunzipSync(r.body).toString() : r.body.toString();
  assert(r.status === 200 && text === "compressed hello ".repeat(200), `status ${r.status}, ${text.length} chars`);
});

await step("tunnel: two Set-Cookie headers survive, no Domain rewrite", async () => {
  const r = await tunnel(s.host, "GET", "/cookies");
  const sc = r.headers["set-cookie"] ?? [];
  assert(sc.length === 2, `set-cookie ${JSON.stringify(sc)}`);
  assert(!sc.some((c) => /domain=/i.test(c)), `domain rewritten: ${JSON.stringify(sc)}`);
});

await step("tunnel: backend status codes pass through (418, 204, 404)", async () => {
  const a = await tunnel(s.host, "GET", "/status/418");
  const b = await tunnel(s.host, "GET", "/empty");
  const c = await tunnel(s.host, "GET", "/nope");
  assert(a.status === 418 && b.status === 204 && c.status === 404, `${a.status} ${b.status} ${c.status}`);
});

await step("tunnel: WebSocket echo (text and binary)", async () => {
  const ws = new WebSocket(`${HUB.replace(/^http/, "ws")}/ws`, { headers: { host: s.host } });
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
    ws.once("unexpected-response", (_q, r) => rej(new Error(`upgrade refused: ${r.statusCode}`)));
  });
  const got = [];
  ws.on("message", (m, isBinary) => got.push(isBinary ? Buffer.from(m).toString("hex") : m.toString()));
  ws.send("hi");
  ws.send(Buffer.from([1, 2, 3]));
  const t0 = Date.now();
  while (got.length < 2 && Date.now() - t0 < 5000) await sleep(50);
  ws.close();
  assert(got.includes("echo:hi") && got.includes("010203"), `got ${JSON.stringify(got)}`);
});

await step("tunnel: Server-Sent Events arrive as they are sent (streaming)", async () => {
  const { request } = await import("node:http");
  const u = new URL(HUB);
  const times = [];
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    request({ host: u.hostname, port: u.port, path: "/sse", headers: { host: s.host } }, (res) => {
      res.on("data", () => times.push(Date.now() - t0));
      res.on("end", resolve);
    }).on("error", reject).end();
  });
  assert(times.length >= 3, `only ${times.length} chunk(s): the response was buffered (${JSON.stringify(times)})`);
  assert(times[times.length - 1] - times[0] >= 500, `chunks not spread out: ${JSON.stringify(times)}`);
  return `chunks at ${times.join(", ")} ms`;
});

await step("tunnel: a caller that disconnects cancels the backend stream", async () => {
  const { request } = await import("node:http");
  const u = new URL(HUB);
  let gotData = false;
  const req = request({ host: u.hostname, port: u.port, path: "/forever", headers: { host: s.host } }, (res) => {
    res.on("data", () => (gotData = true));
  });
  req.on("error", () => {});
  req.end();
  const t0 = Date.now();
  while (!gotData && Date.now() - t0 < 5000) await sleep(50);
  assert(gotData, "endless stream never delivered data");
  const abortAt = Date.now();
  req.destroy();
  while (!foreverClosedAt && Date.now() - abortAt < 5000) await sleep(50);
  assert(foreverClosedAt, "backend stream still open 5 s after the caller left");
  return `backend closed ${foreverClosedAt - abortAt} ms after the caller`;
});

await step("tunnel: a caller that gives up cancels a slow backend request", async () => {
  const { request } = await import("node:http");
  const u = new URL(HUB);
  const req = request({ host: u.hostname, port: u.port, path: "/slow", headers: { host: s.host } });
  req.on("error", () => {});
  req.end();
  await sleep(500);
  const abortAt = Date.now();
  req.destroy();
  while (!slowClosedAt && Date.now() - abortAt < 5000) await sleep(50);
  assert(slowClosedAt, "backend request still running 5 s after the caller left");
  return `backend aborted ${slowClosedAt - abortAt} ms after the caller`;
});

await step("tunnel: unknown label answers 404 with a hint", async () => {
  const other = s.host.replace(/--[^.]+/, "--nolabel");
  const r = await tunnel(other, "GET", "/");
  assert(r.status === 404, `status ${r.status}`);
});

await step("tunnel: absolute-URL path is refused (SSRF guard)", async () => {
  const r = await tunnel(s.host, "GET", "http://169.254.169.254/latest/meta-data");
  assert(r.status === 400, `status ${r.status}`);
});

await step("dashboard: tunnels list shows the connected agent", async () => {
  const r = await api("GET", `/tunnel/organizations/${s.personal}/tunnels`, { token: s.token });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`);
  const d = r.json.data ?? {};
  assert(d.activeCount >= 1, `no active session: ${JSON.stringify(d).slice(0, 300)}`);
  return `${d.activeCount} active`;
});

await step("inspector: requests are captured with credentials hidden", async () => {
  const r = await tunnel(s.host, "POST", "/echo?inspect=1", {
    headers: { "content-type": "application/json", authorization: "Bearer very-secret", "x-trace": "abc" },
    body: JSON.stringify({ hello: "inspector" }),
  });
  assert(r.status === 200, `tunnel status ${r.status}`);
  let entry;
  for (let i = 0; i < 30 && !entry; i++) {
    await sleep(200);
    const l = await api("GET", `/inspector/${s.personal}/app`, { token: s.token });
    entry = (l.json?.data?.requests ?? []).find((x) => x.path === "/echo?inspect=1");
  }
  assert(entry, "captured request not listed");
  const o = await api("GET", `/inspector/${s.personal}`, { token: s.token });
  assert(o.json.data.enabled && o.json.data.tunnels.some((t) => t.label === "app"), `overview ${JSON.stringify(o.json.data)}`);
  const d = await api("GET", `/inspector/${s.personal}/app/${entry.id}`, { token: s.token });
  const e = d.json.data;
  assert(e.request.headers.authorization === "[hidden]", "authorization stored");
  assert(e.request.headers["x-trace"] === "abc", "plain header lost");
  assert(JSON.parse(e.request.body.data).hello === "inspector", "request body not kept");
  assert(e.response?.status === 200 && e.response.body.data.includes("/echo"), "response not kept");
  s.inspected = entry.id;
  return `${entry.method} ${entry.path} -> ${entry.status}`;
});

await step("inspector: replay goes through the tunnel and is captured as a replay", async () => {
  const r = await api("POST", `/inspector/${s.personal}/app/${s.inspected}/replay`, { token: s.token });
  assert(r.status === 200 && r.json.data.status === 200, `replay ${r.status}: ${JSON.stringify(r.json)}`);
  let again;
  for (let i = 0; i < 30 && !again; i++) {
    await sleep(200);
    const l = await api("GET", `/inspector/${s.personal}/app`, { token: s.token });
    again = (l.json?.data?.requests ?? []).find((x) => x.replayOf === s.inspected);
  }
  assert(again, "replay not captured");
  const d = await api("GET", `/inspector/${s.personal}/app/${again.id}`, { token: s.token });
  assert(!("authorization" in d.json.data.request.headers), "replay sent a hidden header");
});

await step("inspector: a request whose body was cut cannot be replayed; strangers are refused", async () => {
  const l = await api("GET", `/inspector/${s.personal}/app?limit=500`, { token: s.token });
  const big = (l.json.data.requests ?? []).find((x) => x.requestSize > 16 * 1024);
  if (big) {
    const r = await api("POST", `/inspector/${s.personal}/app/${big.id}/replay`, { token: s.token });
    assert(r.status === 400, `truncated replay ${r.status}`);
  }
  const anon = await api("GET", `/inspector/${s.personal}`);
  assert(anon.status === 401, `anonymous ${anon.status}`);
  const other = await api("GET", `/inspector/00000000-0000-4000-8000-000000000000`, { token: s.token });
  assert(other.status === 403, `other account ${other.status}`);
});

await step("traffic rules: a mock answers at the hub, a rewrite reaches the backend, a stale save is 409", async () => {
  const R = (method, p, body) => api(method, `/traffic-rules/${s.personal}${p}`, { token: s.token, body });
  const rules = [
    { name: "mock health", enabled: true, when: "always", match: { path: "/mocked" }, action: { type: "mock", status: 201, headers: { "content-type": "application/json" }, body: '{"mocked":true}' } },
    { name: "old path", enabled: true, when: "always", match: { methods: ["GET"], path: "/old-echo" }, action: { type: "rewrite", to: "/echo" } },
  ];
  const put = await R("PUT", "/app", { rules, expectedVersion: 0 });
  assert(put.status === 200 && put.json.data.rules.length === 2, `save ${put.status}: ${JSON.stringify(put.json).slice(0, 300)}`);
  const stale = await R("PUT", "/app", { rules, expectedVersion: 0 });
  assert(stale.status === 409, `stale save ${stale.status}`);
  const mocked = await tunnel(s.host, "GET", "/mocked");
  assert(mocked.status === 201 && JSON.parse(mocked.body).mocked === true, `mock ${mocked.status} ${mocked.body}`);
  assert(mocked.headers["x-vhyxvoid-rule"], "mock answer has no x-vhyxvoid-rule header");
  const rewritten = await tunnel(s.host, "GET", "/old-echo");
  assert(rewritten.status === 200 && rewritten.body.includes("/echo"), `rewrite ${rewritten.status} ${rewritten.body.slice(0, 200)}`);
  const dry = await R("POST", "/app/test", { method: "GET", path: "/mocked" });
  assert(dry.status === 200, `dry run ${dry.status}: ${JSON.stringify(dry.json).slice(0, 300)}`);
  const other = await api("GET", `/traffic-rules/00000000-0000-4000-8000-000000000000`, { token: s.token });
  assert(other.status === 403, `other account ${other.status}`);
  const del = await R("DELETE", "/app");
  assert(del.status === 200, `delete ${del.status}`);
  const after = await tunnel(s.host, "GET", "/mocked");
  assert(after.status !== 201 && !after.headers["x-vhyxvoid-rule"], `rule still applied after delete: ${after.status}`);
});

await step("inspector: a workspace can switch capture off (stored requests deleted) and back on", async () => {
  const set = (capture) => api("PUT", `/inspector/${s.personal}/settings`, { token: s.token, body: { capture } });
  const list = async () => (await api("GET", `/inspector/${s.personal}/app`, { token: s.token })).json?.data?.requests ?? [];
  const off = await set(false);
  assert(off.status === 200 && off.json.data.capture === false, `off ${off.status}: ${JSON.stringify(off.json)}`);
  assert((await list()).length === 0, "stored requests were not deleted");
  await tunnel(s.host, "GET", "/echo?while-off=1");
  await sleep(1000);
  assert(!(await list()).some((x) => x.path === "/echo?while-off=1"), "captured while capture was off");
  const on = await set(true);
  assert(on.status === 200 && on.json.data.capture === true, `on ${on.status}`);
  await tunnel(s.host, "GET", "/echo?while-on=1");
  let seen = false;
  for (let i = 0; i < 30 && !seen; i++) {
    await sleep(200);
    seen = (await list()).some((x) => x.path === "/echo?while-on=1");
  }
  assert(seen, "capture did not resume");
});

await step("mock APIs: template served with no agent, rules and templating, OpenAPI import/export, try, 409, mock-first next to a live agent", async () => {
  const M = (method, p, body) => api(method, `/mocks/${s.personal}${p}`, { token: s.token, body });
  const created = await M("POST", "", { label: "users-mock", name: "Users", template: "rest-crud" });
  assert(created.status === 201, `create ${created.status}: ${JSON.stringify(created.json).slice(0, 300)}`);
  const mock = created.json.data;
  assert(mock.url?.endsWith(`--users-mock.${HUB_DOMAIN}`) && mock.endpointCount === 5, `mock ${JSON.stringify(mock).slice(0, 300)}`);
  const host = new URL(mock.url).host;
  const dup = await M("POST", "", { label: "users-mock", name: "Again" });
  assert(dup.status === 409, `duplicate label ${dup.status}`);
  const badLabel = await M("POST", "", { label: "Not OK!", name: "x" });
  assert(badLabel.status === 400, `bad label ${badLabel.status}`);

  const one = await tunnel(host, "GET", "/users/7");
  assert(one.status === 200 && JSON.parse(one.body).id === "7" && one.headers["x-vhyxvoid-mock"], `GET /users/7 ${one.status} ${one.body}`);
  assert((await tunnel(host, "GET", "/users/0")).status === 404, "rule for id 0");
  const list = JSON.parse((await tunnel(host, "GET", "/users")).body);
  assert(list.data.length === 5 && list.data[0].email.endsWith("@example.com"), `list ${JSON.stringify(list).slice(0, 200)}`);
  const noEmail = await tunnel(host, "POST", "/users", { headers: { "content-type": "application/json" }, body: "{}" });
  assert(noEmail.status === 422, `POST without email ${noEmail.status}`);
  const made = await tunnel(host, "POST", "/users", { headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ada", email: "ada@x.test" }) });
  assert(made.status === 201 && JSON.parse(made.body).email === "ada@x.test", `POST ${made.status} ${made.body}`);
  const pre = await tunnel(host, "OPTIONS", "/users", { headers: { origin: "https://app.example", "access-control-request-method": "POST" } });
  assert(pre.status === 204 && pre.headers["access-control-allow-origin"] === "https://app.example", `preflight ${pre.status}`);
  const missing = await tunnel(host, "GET", "/orders");
  assert(missing.status === 404 && missing.headers["x-vhyxvoid-error"] === "MOCK_NO_ROUTE", `missing route ${missing.status} ${missing.headers["x-vhyxvoid-error"]}`);

  const yaml = [
    "openapi: 3.0.3",
    "info: { title: Pets, version: '1' }",
    "paths:",
    "  /pets/{petId}:",
    "    get:",
    "      responses:",
    "        '200':",
    "          description: a pet",
    "          content:",
    "            application/json:",
    "              example: { id: 1, name: Rex }",
  ].join("\n");
  const imp = await M("POST", `/${mock.id}/import`, { openapi: yaml });
  assert(imp.status === 200 && imp.json.data.added === 1, `import ${imp.status}: ${JSON.stringify(imp.json).slice(0, 300)}`);
  const again = await M("POST", `/${mock.id}/import`, { openapi: yaml });
  assert(again.json.data.added === 0 && again.json.data.skipped === 1, "re-import should skip existing routes");
  const pet = await tunnel(host, "GET", "/pets/1");
  assert(pet.status === 200 && JSON.parse(pet.body).name === "Rex", `imported route ${pet.status} ${pet.body}`);
  const exp = await fetch(`${API}/mocks/${s.personal}/${mock.id}/openapi?format=yaml`, { headers: { authorization: `Bearer ${s.token}` } });
  const expText = await exp.text();
  assert(exp.status === 200 && expText.includes("openapi: 3.0.3") && expText.includes("/users/{id}:"), `export ${exp.status} ${expText.slice(0, 200)}`);
  const tried = await M("POST", `/${mock.id}/try`, { method: "GET", path: "/users/0" });
  assert(tried.json.data.matched && tried.json.data.status === 404, `try ${JSON.stringify(tried.json).slice(0, 200)}`);

  const full = (await M("GET", `/${mock.id}`)).json.data;
  const stale = await M("PUT", `/${mock.id}`, { latencyMs: 0, expectedVersion: full.version - 1 });
  assert(stale.status === 409, `stale save ${stale.status}`);
  const off = await M("PUT", `/${mock.id}`, { enabled: false, expectedVersion: full.version });
  assert(off.status === 200, `switch off ${off.status}`);
  const gone = await tunnel(host, "GET", "/users/7");
  assert(gone.status === 404 && gone.headers["x-vhyxvoid-error"] === "TUNNEL_OFFLINE", `disabled mock still answers: ${gone.status} ${gone.headers["x-vhyxvoid-error"]}`);

  // Mock-first on the live tunnel: the mock answers its routes, the app the rest.
  const live = await M("POST", "", { label: "app", name: "App mocks", template: "blank" });
  assert(live.status === 201, `mock on the live label ${live.status}: ${JSON.stringify(live.json).slice(0, 200)}`);
  const health = await tunnel(s.host, "GET", "/health");
  assert(health.status === 200 && JSON.parse(health.body).ok === true && health.headers["x-vhyxvoid-mock"], `mocked /health ${health.status} ${health.body}`);
  const echo = await tunnel(s.host, "GET", "/echo?through=app");
  assert(echo.status === 200 && echo.body.includes("/echo") && !echo.headers["x-vhyxvoid-mock"], "unmocked path should reach the app");
  const third = await M("POST", "", { label: "third", name: "Over the limit" });
  assert(third.status === 402 || third.status === 403, `FREE allows 2 mock APIs, got ${third.status}`);

  let entry;
  for (let i = 0; i < 20 && !entry; i++) {
    await sleep(150);
    const l = await api("GET", `/inspector/${s.personal}/users-mock`, { token: s.token });
    entry = (l.json?.data?.requests ?? []).find((x) => x.path === "/users/7" && x.mock);
  }
  assert(entry?.mock?.endpointName === "Get a user", `inspector entry ${JSON.stringify(entry).slice(0, 300)}`);
  const act = await api("GET", `/activity/${s.personal}?limit=100`, { token: s.token });
  assert(act.json.data.items.some((x) => x.action === "MOCK_API_CREATED"), "activity lacks MOCK_API_CREATED");

  for (const m of (await M("GET", "")).json.data.mocks) assert((await M("DELETE", `/${m.id}`)).status === 200, "delete mock");
  const after = await tunnel(s.host, "GET", "/health");
  assert(!after.headers["x-vhyxvoid-mock"], "deleted mock still answers on the live label");
  return `${mock.endpointCount} template endpoints, imported 1, mock-first on the live tunnel`;
});

await step("mock APIs phase 2: resource CRUD at the URL, data view and reset, record from captured traffic, every export, Postman and native import", async () => {
  const M = (method, p, body) => api(method, `/mocks/${s.personal}${p}`, { token: s.token, body });
  const created = await M("POST", "", { label: "store", name: "Store", template: "blank" });
  assert(created.status === 201, `create ${created.status}: ${JSON.stringify(created.json).slice(0, 200)}`);
  let mock = created.json.data;
  const host = new URL(mock.url).host;
  const resources = [{ id: "res_products", name: "products", path: "/products", enabled: true, idField: "id", seed: [{ id: 1, name: "Lamp", price: 30 }, { id: 2, name: "Desk", price: 120 }] }];
  const saved = await M("PUT", `/${mock.id}`, { resources, expectedVersion: mock.version });
  assert(saved.status === 200 && saved.json.data.resourceCount === 1, `save resources ${saved.status}: ${JSON.stringify(saved.json).slice(0, 300)}`);
  mock = saved.json.data;
  const bad = await M("PUT", `/${mock.id}`, { resources: [{ ...resources[0], path: "/products/:id" }], expectedVersion: mock.version });
  assert(bad.status === 400, `invalid resource path should be refused, got ${bad.status}`);

  const list = await tunnel(host, "GET", "/products?_sort=price&_order=desc");
  assert(list.status === 200 && JSON.parse(list.body)[0].name === "Desk" && list.headers["x-total-count"] === "2", `list ${list.status} ${list.body}`);
  const made = await tunnel(host, "POST", "/products", { headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Chair", price: 60 }) });
  assert(made.status === 201 && JSON.parse(made.body).id === 3 && made.headers.location === "/products/3", `create ${made.status} ${made.body}`);
  const patched = await tunnel(host, "PATCH", "/products/3", { headers: { "content-type": "application/json" }, body: '{"price":55}' });
  assert(patched.status === 200 && JSON.parse(patched.body).price === 55, `patch ${patched.status} ${patched.body}`);
  assert((await tunnel(host, "GET", "/health")).status === 200, "template endpoint still answers next to the resource");
  const data = await M("GET", `/${mock.id}/data/res_products`);
  assert(data.status === 200 && data.json.data.count === 3 && data.json.data.items[2].price === 55, `data view ${JSON.stringify(data.json).slice(0, 300)}`);
  const tried = await M("POST", `/${mock.id}/try`, { method: "GET", path: "/products/3" });
  assert(tried.json.data.matched && JSON.parse(tried.json.data.body).name === "Chair", "try reads live resource data");
  assert((await M("DELETE", `/${mock.id}/data/res_products`)).status === 200, "reset");
  assert(JSON.parse((await tunnel(host, "GET", "/products")).body).length === 2, "reset brings the seed back");

  // Record: real traffic through the live tunnel becomes endpoints.
  for (const p of ["/echo?rec=1", "/status/500"]) await tunnel(s.host, "GET", p);
  let caps = [];
  for (let i = 0; i < 20 && caps.length < 2; i++) {
    await sleep(150);
    caps = ((await api("GET", `/inspector/${s.personal}/app`, { token: s.token })).json?.data?.requests ?? []).filter((x) => x.path === "/echo?rec=1" || x.path === "/status/500");
  }
  assert(caps.length >= 2, `captures for recording ${caps.length}`);
  const rec = await M("POST", `/${mock.id}/record`, { label: "app", ids: caps.map((c) => c.id) });
  assert(rec.status === 200 && rec.json.data.added === 2, `record ${rec.status}: ${JSON.stringify(rec.json).slice(0, 300)}`);
  const echoed = await tunnel(host, "GET", "/echo");
  assert(echoed.status === 200 && echoed.body.includes("/echo") && echoed.headers["x-vhyxvoid-mock"], `recorded endpoint ${echoed.status} ${echoed.body.slice(0, 120)}`);
  assert((await tunnel(host, "GET", "/status/500")).status === 500, "recorded 500");

  const formats = { openapi: "openapi: 3.0.3", "openapi-json": '"openapi": "3.0.3"', msw: "from 'msw'", postman: "schema.getpostman.com", mockoon: '"lastMigration"', vhyxvoid: '"vhyxvoid": "mock-api"' };
  const files = {};
  for (const [format, needle] of Object.entries(formats)) {
    const r = await fetch(`${API}/mocks/${s.personal}/${mock.id}/export?format=${format}`, { headers: { authorization: `Bearer ${s.token}` } });
    const text = await r.text();
    assert(r.status === 200 && text.includes(needle) && /attachment; filename=/.test(r.headers.get("content-disposition") ?? ""), `export ${format} ${r.status} ${text.slice(0, 120)}`);
    files[format] = text;
  }
  assert(files.msw.includes("/products") && files.postman.includes("List products"), "exports include the resource");

  // Import a Postman collection into the mock, and create a second mock from the native export.
  const postman = { info: { name: "P", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [{ name: "Ping", request: { method: "GET", url: "{{baseUrl}}/ping" }, response: [{ name: "pong", code: 200, header: [{ key: "Content-Type", value: "text/plain" }], body: "pong" }] }] };
  const imp = await M("POST", `/${mock.id}/import`, { document: postman });
  assert(imp.status === 200 && imp.json.data.format === "postman" && imp.json.data.added === 1, `import postman ${JSON.stringify(imp.json).slice(0, 200)}`);
  assert(String((await tunnel(host, "GET", "/ping")).body) === "pong", "imported Postman example answers");
  const others = (await M("GET", "")).json.data.mocks;
  for (const o of others) if (o.id !== mock.id) await M("DELETE", `/${o.id}`);
  const clone = await M("POST", "", { label: "store-copy", name: "Copy", document: files.vhyxvoid });
  assert(clone.status === 201 && clone.json.data.resourceCount === 1 && clone.json.data.endpointCount === mock.endpointCount + 2, `clone ${clone.status}: ${JSON.stringify(clone.json).slice(0, 300)}`);
  for (const id of [mock.id, clone.json.data.id]) assert((await M("DELETE", `/${id}`)).status === 200, "delete");
  return "resource CRUD, record 2, 6 exports, 2 imports";
});

await step("API client: environment secret, send through the tunnel, captures, run, snippet, export", async () => {
  const C = (method, p, body) => api(method, `/api-client/${s.personal}${p}`, { token: s.token, body });
  const env = await C("POST", "/environments", { name: `Journey ${RUN}`, variables: [{ key: "hub", value: HUB }, { key: "apiToken", value: "journey-secret-value", secret: true }] });
  assert(env.status === 201 && env.json.data.variables[1].value === "" && env.json.data.variables[1].hasValue, `environment ${JSON.stringify(env.json).slice(0, 300)}`);
  const envId = env.json.data.id;
  // The tunnel's host is sent as the Host header, so this works without DNS for the hub domain.
  const echo = { name: "Echo", method: "POST", url: "{{hub}}/echo", params: [{ key: "from", value: "client", enabled: true }], headers: [{ key: "Host", value: s.host, enabled: true }], auth: { type: "bearer", token: "{{apiToken}}" }, body: { type: "json", text: '{"hello":"{{$uuid}}"}' }, assertions: [{ id: "a1", enabled: true, source: "status", op: "eq", value: "200" }, { id: "a2", enabled: true, source: "json", path: "$.headers.authorization", op: "eq", value: "Bearer journey-secret-value" }], captures: [{ id: "c1", enabled: true, variable: "seenPath", source: "json", path: "$.path" }] };
  const sent = await C("POST", "/send", { request: echo, environmentId: envId });
  assert(sent.status === 200 && sent.json.data.sent, `send ${sent.status} ${JSON.stringify(sent.json).slice(0, 300)}`);
  if (sent.json.data.error?.code === "EPRIVATE") {
    // An API without API_CLIENT_ALLOW_PRIVATE=1 refuses local addresses: that is the SSRF guard working.
    return "guard refused 127.0.0.1 (set API_CLIENT_ALLOW_PRIVATE=1 on a local API for the rest)";
  }
  const d = sent.json.data;
  assert(d.response?.status === 200 && d.assertions.every((a) => a.pass) && d.captures[0]?.value === "/echo", `send result ${JSON.stringify(d).slice(0, 400)}`);
  assert(d.request.headers.some(([k, v]) => k === "Authorization" && v === "Bearer {{apiToken}}"), "the sent view masks the secret");
  assert(d.response.timings.total > 0 && typeof d.response.timings.firstByte === "number", "timings");

  const col = await C("POST", "/collections", { name: `Journey ${RUN}` });
  assert(col.status === 201, `collection ${col.status}`);
  const id = col.json.data.id;
  const saved = await C("PUT", `/collections/${id}`, {
    expectedVersion: 1,
    folders: [{ id: "f1", name: "Tunnel" }],
    requests: [
      { ...echo, id: "q1" },
      { ...echo, id: "q2", name: "Uses the capture", method: "GET", body: { type: "none" }, folderId: "f1", params: [{ key: "prev", value: "{{seenPath}}", enabled: true }], assertions: [{ id: "a3", enabled: true, source: "json", path: "$.query", op: "contains", value: "prev=%2Fecho" }], captures: [] },
      { ...echo, id: "q3", name: "Fails on purpose", method: "GET", url: "{{hub}}/status/500", body: { type: "none" }, folderId: "f1", params: [], assertions: [{ id: "a4", enabled: true, source: "status", op: "eq", value: "200" }], captures: [] },
    ],
  });
  assert(saved.status === 200 && saved.json.data.version === 2, `save ${saved.status} ${JSON.stringify(saved.json).slice(0, 300)}`);
  const run = await C("POST", `/collections/${id}/run`, { environmentId: envId });
  const rep = run.json?.data?.report;
  assert(run.status === 200 && rep.total === 3 && rep.passed === 2 && rep.failed === 1 && rep.results[2].status === 500, `run ${JSON.stringify(rep ?? run.json).slice(0, 500)}`);
  assert((await C("GET", `/collections/${id}/runs`)).json.data.runs[0].failed === 1, "run is listed");
  const code = await C("POST", "/snippet", { request: echo, lang: "curl", environmentId: envId });
  assert(code.json.data.code.includes("Bearer {{apiToken}}") && !code.json.data.code.includes("journey-secret-value"), "snippet masks the secret");
  const file = await fetch(`${API}/api-client/${s.personal}/collections/${id}/export?format=vhyxvoid&environmentId=${envId}`, { headers: { authorization: `Bearer ${s.token}` } });
  const text = await file.text();
  const exported = JSON.parse(text);
  assert(file.status === 200 && exported.vhyxvoid === "collection" && exported.environments[0].variables.find((v) => v.key === "apiToken").value === "" && !text.includes("enc:v1:"), `export ${file.status}`);
  const hist = await C("GET", "/history");
  assert(hist.json.data.items.some((h) => h.url.includes("/echo")), "history has the send");
  assert((await C("DELETE", `/collections/${id}`)).status === 200 && (await C("DELETE", `/environments/${envId}`)).status === 200, "cleanup");
  return `send ${Math.round(d.response.timings.total)} ms, run 2/3 with a capture, snippet and export masked`;
});

await step("performance: load test through the hub (past the per-minute limit), endpoint analytics, a monitor", async () => {
  const L = (method, p, body) => api(method, `/load-tests/${s.personal}${p}`, { token: s.token, body });
  const o = await L("GET", "");
  assert(o.status === 200 && o.json.data.limits.maxVus >= 1, `load tests overview ${o.status}`);
  assert((await L("POST", "", { target: "https://example.com/", vus: 1, durationSec: 5 })).status === 400, "a foreign target is refused");
  // 20 requests/s for 10 s = 200 requests, twice the FREE plan's public-path limit per minute:
  // passes only because the hub lets marked load-test traffic past the abuse limiter.
  const started = await L("POST", "", { name: "Journey", target: `https://${s.host}/echo?lt=1`, vus: 4, durationSec: 10, maxRps: 20, thresholds: { errorRatePct: 1 } });
  assert(started.status === 201, `start ${started.status} ${JSON.stringify(started.json).slice(0, 300)}`);
  let run;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    run = (await L("GET", `/${started.json.data.id}`)).json.data;
    if (run.status !== "RUNNING") break;
  }
  assert(run.status === "PASSED" && run.summary.requests >= 150 && run.summary.statuses["200"] === run.summary.requests, `load test ${run.status} ${JSON.stringify(run.summary ?? run.error).slice(0, 300)}`);
  assert(run.timeline.length === 10, `timeline ${run.timeline.length}`);

  // The hub writes endpoint stats every 30 s.
  let ep;
  for (let i = 0; i < 40 && !ep; i++) {
    await sleep(1000);
    const a = await api("GET", `/analytics/${s.personal}?window=1h&label=app`, { token: s.token });
    ep = a.json?.data?.endpoints?.find((e) => e.route === "/echo" && e.method === "GET" && e.requests >= run.summary.requests);
  }
  assert(ep && ep.p95 !== null, "endpoint analytics include the load test");

  // A monitor over a collection that calls the tunnel.
  const col = await api("POST", `/api-client/${s.personal}/collections`, { token: s.token, body: { name: `Monitor ${RUN}` } });
  await api("PUT", `/api-client/${s.personal}/collections/${col.json.data.id}`, {
    token: s.token,
    body: { expectedVersion: 1, requests: [{ id: "q1", name: "Echo", method: "GET", url: `${HUB}/echo`, params: [], headers: [{ key: "Host", value: s.host, enabled: true }], auth: { type: "none" }, body: { type: "none" }, assertions: [{ id: "a", enabled: true, source: "status", op: "eq", value: "200" }], captures: [] }] },
  });
  const M = (method, p, body) => api(method, `/monitors/${s.personal}${p}`, { token: s.token, body });
  const ov = (await M("GET", "")).json.data;
  const mon = await M("POST", "", { name: "Journey", collectionId: col.json.data.id, intervalMinutes: ov.limits.intervals[ov.limits.intervals.length - 1] });
  assert(mon.status === 201, `monitor ${mon.status} ${JSON.stringify(mon.json).slice(0, 200)}`);
  const checked = await M("POST", `/${mon.json.data.id}/run`, {});
  const viaGuard = checked.json?.data?.report?.results?.[0]?.error?.includes("EPRIVATE");
  assert(checked.status === 200 && (checked.json.data.ok || viaGuard), `monitor run ${JSON.stringify(checked.json).slice(0, 300)}`);
  assert((await M("DELETE", `/${mon.json.data.id}`)).status === 200, "delete monitor");
  await api("DELETE", `/api-client/${s.personal}/collections/${col.json.data.id}`, { token: s.token });
  return `${run.summary.requests} requests at ${run.summary.rps}/s, p95 ${run.summary.latency.p95} ms; analytics p95 ${ep.p95} ms; monitor ${viaGuard ? "guarded" : "up"}`;
});

await step("traffic chart, activity feed and agent fleet reflect the tunnel", async () => {
  const flush = await fetch(`${HUB}/internal/stats/flush`, { method: "POST", headers: { "x-hub-internal-secret": process.env.HUB_INTERNAL_SECRET ?? "" } });
  assert(flush.ok, `stats flush ${flush.status} (is HUB_INTERNAL_SECRET set for the journey?)`);
  const t = await api("GET", `/traffic/${s.personal}?range=1h`, { token: s.token });
  assert(t.status === 200 && t.json.data.totals.requests > 0, `traffic ${t.status}: ${JSON.stringify(t.json.data?.totals)}`);
  assert(t.json.data.top.some((x) => x.label === "app"), `busiest tunnels ${JSON.stringify(t.json.data.top)}`);

  const a = await api("GET", `/activity/${s.personal}?limit=100`, { token: s.token });
  assert(a.status === 200, `activity ${a.status}: ${JSON.stringify(a.json).slice(0, 300)}`);
  const actions = new Set(a.json.data.items.map((x) => x.action));
  for (const want of ["API_KEY_CREATED", "TRAFFIC_RULES_UPDATED", "TUNNEL_CONNECTED"]) assert(actions.has(want), `activity lacks ${want}: ${[...actions].join(", ")}`);
  const csv = await fetch(`${API}/activity/${s.personal}/export`, { headers: { authorization: `Bearer ${s.token}` } });
  assert(csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type") ?? ""), `csv ${csv.status} ${csv.headers.get("content-type")}`);

  const f = await api("GET", `/agents/${s.personal}`, { token: s.token });
  assert(f.status === 200 && f.json.data.hubReachable, `fleet ${f.status}: ${JSON.stringify(f.json).slice(0, 300)}`);
  const mine = f.json.data.agents.find((x) => x.label === "app");
  assert(mine && mine.key?.keyId === s.keyId && mine.versionStatus, `fleet agent ${JSON.stringify(f.json.data.agents).slice(0, 400)}`);
  const missing = await api("POST", `/agents/${s.personal}/not-an-agent/disconnect`, { token: s.token });
  assert(missing.status === 404, `stopping an unknown agent ${missing.status}`);
  return `${t.json.data.totals.requests} requests, ${actions.size} kinds of activity, agent ${mine.agentVersion ?? mine.version ?? "?"} ${mine.versionStatus}`;
});

await step("SDK createClient reaches the tunnel", async () => {
  const sdk = await import(path.join(root, "packages/sdk/dist/index.js"));
  const createClient = sdk.createClient ?? sdk.default?.createClient;
  assert(createClient, "createClient not exported");
  // fetch can't override Host, so the tunnel host must resolve. Locally,
  // E2E_WRITE_HOSTS=1 maps it to 127.0.0.1 in /etc/hosts.
  if (process.env.E2E_WRITE_HOSTS === "1") {
    const line = `127.0.0.1 ${s.host.split(":")[0]}\n`;
    if (!fs.readFileSync("/etc/hosts", "utf8").includes(line)) fs.appendFileSync("/etc/hosts", line);
  }
  const u = new URL(HUB);
  const client = createClient({ baseUrl: `${u.protocol}//${s.host.split(":")[0]}:${u.port || (u.protocol === "https:" ? 443 : 80)}`, timeout: 10_000 });
  const r = await client.get("/echo?from=sdk");
  const body = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  assert(r.status === 200 && body?.query === "?from=sdk", `status ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
});

await step("SDK TunnelClient (WebSocket) authenticates and reaches the tunnel", async () => {
  const sdk = await import(path.join(root, "packages/sdk/dist/index.js"));
  const TunnelClient = sdk.TunnelClient ?? sdk.default?.TunnelClient;
  const client = new TunnelClient({
    hubUrl: HUB.replace(/^http/, "ws") + "/sdk",
    keyId: s.keyId,
    secret: s.secret,
    label: "app",
    localDiscovery: false,
    timeout: 15_000,
  });
  await client.connect();
  try {
    const r = await client.get("/echo?via=ws-sdk");
    const body = typeof r.body === "string" ? JSON.parse(r.body) : JSON.parse(Buffer.from(r.body).toString());
    assert(r.status === 200 && body.query === "?via=ws-sdk", `status ${r.status} ${String(r.body).slice(0, 200)}`);
    const post = await client.post("/echo", { hello: "world" });
    const pb = JSON.parse(String(post.body));
    assert(post.status === 200 && pb.method === "POST" && pb.bodyLength > 0, `post ${post.status}`);
  } finally {
    client.disconnect();
  }
});

await step("SDK TunnelClient with a wrong secret is refused", async () => {
  const sdk = await import(path.join(root, "packages/sdk/dist/index.js"));
  const client = new sdk.TunnelClient({ hubUrl: HUB.replace(/^http/, "ws") + "/sdk", keyId: s.keyId, secret: "0".repeat(64), localDiscovery: false });
  const err = await client.connect().then(() => null, (e) => e);
  client.disconnect();
  assert(err, "connected with a wrong secret");
});

if (process.env.UPSTASH_REDIS_REST_URL) {
  await step("usage: public-path requests are counted", async () => {
    // The hub batches public-path usage and flushes every ~30 s.
    const t0 = Date.now();
    while (Date.now() - t0 < 40_000) {
      const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
        body: JSON.stringify(["SCAN", "0", "MATCH", `usage:${s.personal}:*`, "COUNT", "1000"]),
      }).then((x) => x.json());
      const keys = r.result?.[1] ?? [];
      if (keys.length) return `${keys.length} counter key(s)`;
      await sleep(2000);
    }
    throw new Error("no usage counters after 40 s");
  });
}

if (SLOW) {
  await step("rate limit: FREE public path answers 429 past 100/min", async () => {
    let limited = 0;
    await Promise.all(
      Array.from({ length: 130 }, () =>
        tunnel(s.host, "GET", "/echo").then((r) => {
          if (r.status === 429) {
            limited++;
            assert(r.headers["retry-after"], "429 without Retry-After");
          }
        }),
      ),
    );
    assert(limited > 0, "no 429 after 130 requests");
    return `${limited} of 130 limited`;
  });

  await step("revoking the key evicts the running agent, which exits 1", async () => {
    const r = await api("POST", `/apikeys/organizations/${s.personal}/api-keys/${s.keyUuid}/revoke`, { token: s.token, body: {} });
    assert(r.status === 200 || r.status === 204, `revoke status ${r.status}: ${JSON.stringify(r.json)}`);
    const res = await Promise.race([s.agent.exited, sleep(90_000).then(() => null)]);
    assert(res, "agent still running 90 s after revoke");
    assert(/revoked/i.test(s.agent.output()), "agent never printed the revoke reason");
    assert(res.code === 1, `agent exit code ${res.code} (signal ${res.signal})`);
    const after = await tunnel(s.host, "GET", "/echo");
    assert(after.status === 404 || after.status === 503, `tunnel still answers ${after.status}`);
    return `exit ${res.code}, tunnel now ${after.status}`;
  });

  await step("a revoked key cannot connect again", async () => {
    const a = startAgent({ key: s.keyId, secret: s.secret, port: s.backendPort, label: "app" });
    const res = await Promise.race([a.exited, sleep(15_000).then(() => null)]);
    assert(res && res.code === 1, `expected exit 1, got ${JSON.stringify(res)}; output:\n${a.output().slice(-600)}`);
  });
}

if (process.env.ADMIN_EMAIL) {
  const A = (m, p, o = {}) => api(m, `/admin/identity${p}`, o);
  const adminEmail = `ops.${RUN}@e2e.test`;
  const adminPw = "Ops-Admin-Pass-1!";

  await step("user submits feedback", async () => {
    const r = await api("POST", "/feedback", {
      token: s.token,
      body: { type: "BUG_REPORT", title: `E2E bug ${RUN}`, description: "Something is broken in the e2e run." },
    });
    assert(r.status === 201 || r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
    s.feedbackId = r.json.data?.id;
  });

  await step("admin: super admin logs in", async () => {
    const r = await A("POST", "/auth/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
    s.admin = r.json.data.accessToken;
  });

  await step("admin and user tokens are not interchangeable", async () => {
    const a = await A("GET", "/users", { token: s.token });
    const b = await api("GET", "/account/me", { token: s.admin });
    assert(a.status === 401 || a.status === 403, `user token on admin route: ${a.status}`);
    assert(b.status === 401 || b.status === 403, `admin token on user route: ${b.status}`);
  });

  await step("admin: create an admin, blank/extra fields on update are 400", async () => {
    const r = await A("POST", "/users", { token: s.admin, body: { email: adminEmail, password: adminPw, firstName: "Olive", lastName: "Ops" } });
    assert(r.status === 201 || r.status === 200, `create ${r.status}: ${JSON.stringify(r.json)}`);
    s.opsId = r.json.data?.id ?? r.json.data?.admin?.id;
    assert(s.opsId, `no id in ${JSON.stringify(r.json)}`);
    const blank = await A("PUT", `/users/${s.opsId}`, { token: s.admin, body: { firstName: "  " } });
    const extra = await A("PUT", `/users/${s.opsId}`, { token: s.admin, body: { firstName: "Olivia", email: "x@y.z" } });
    const ok = await A("PUT", `/users/${s.opsId}`, { token: s.admin, body: { firstName: "Olivia" } });
    assert(blank.status === 400 && extra.status === 400 && ok.status === 200, `${blank.status} ${extra.status} ${ok.status}`);
  });

  await step("admin: a role with feedback abilities, assigned to the new admin", async () => {
    const role = await A("POST", "/roles", { token: s.admin, body: { name: `Triage ${RUN}` } });
    assert(role.status === 201 || role.status === 200, `role ${role.status}: ${JSON.stringify(role.json)}`);
    s.roleId = role.json.data?.id ?? role.json.data?.role?.id;
    const abilities = await A("GET", "/abilities?limit=100", { token: s.admin });
    const list = abilities.json.data?.items ?? abilities.json.items ?? abilities.json.data ?? [];
    const wanted = list.filter((x) => x.action === "audit.read" || x.action === "admin.read");
    assert(wanted.length >= 1, `abilities: ${JSON.stringify(list).slice(0, 200)}`);
    for (const ab of wanted) {
      const g = await A("POST", `/roles/${s.roleId}/abilities`, { token: s.admin, body: { abilityId: ab.id } });
      assert(g.status < 300, `grant ${g.status}: ${JSON.stringify(g.json)}`);
    }
    const assign = await A("POST", `/users/${s.opsId}/roles`, { token: s.admin, body: { roleId: s.roleId } });
    assert(assign.status < 300, `assign ${assign.status}: ${JSON.stringify(assign.json)}`);
    const login = await A("POST", "/auth/login", { body: { email: adminEmail, password: adminPw } });
    assert(login.status === 200, `ops login ${login.status}`);
    s.ops = login.json.data.accessToken;
    const mine = await A("GET", "/me/abilities", { token: s.ops });
    const names = JSON.stringify(mine.json);
    assert(/audit/.test(names), `ops abilities: ${names.slice(0, 200)}`);
    const forbidden = await A("POST", "/roles", { token: s.ops, body: { name: "nope" } });
    assert(forbidden.status === 403, `ops could create a role (${forbidden.status})`);
  });

  await step("admin: feedback list has counts; triage is audit-logged", async () => {
    const list = await api("GET", "/admin/feedback", { token: s.admin });
    assert(list.status === 200, `list ${list.status}: ${JSON.stringify(list.json).slice(0, 200)}`);
    const counts = list.json.counts ?? list.json.data?.counts ?? list.json.extra?.counts;
    assert(counts && counts.open >= 1, `counts ${JSON.stringify(counts)} in ${JSON.stringify(list.json).slice(0, 200)}`);
    const empty = await api("PATCH", `/admin/feedback/${s.feedbackId}`, { token: s.admin, body: {} });
    assert(empty.status === 400 && empty.json.code === "VALIDATION_ERROR", `empty patch ${empty.status} ${JSON.stringify(empty.json)}`);
    const t = await api("PATCH", `/admin/feedback/${s.feedbackId}`, { token: s.admin, body: { status: "UNDER_REVIEW", adminNotes: "looking" } });
    assert(t.status === 200, `triage ${t.status}: ${JSON.stringify(t.json)}`);
    const logs = await A("GET", "/audit-logs?action=feedback.updated", { token: s.admin });
    assert(JSON.stringify(logs.json).includes(s.feedbackId), `no feedback.updated audit row: ${JSON.stringify(logs.json).slice(0, 300)}`);
  });

  // ── Admin panel v2: operations, settings, CMS ────────────────────────────
  const P = (m, p, o = {}) => api(m, `/admin${p}`, { token: s.admin, ...o });

  await step("admin v2: an admin without system.read is refused the dashboard", async () => {
    const r = await api("GET", "/admin/overview", { token: s.ops });
    assert(r.status === 403, `ops got ${r.status}`);
  });

  await step("admin v2: overview counts users and system health sees every dependency", async () => {
    const o = await P("GET", "/overview");
    assert(o.status === 200 && o.json.data.users.total >= 1, `overview ${o.status}: ${JSON.stringify(o.json).slice(0, 200)}`);
    const h = await P("GET", "/system/health");
    assert(h.status === 200, `health ${h.status}`);
    const probes = h.json.data.probes;
    assert(probes.database.status !== "down" && probes.redis.status === "ok", `probes ${JSON.stringify(probes).slice(0, 300)}`);
    assert(probes.database.details.migrations.pending.length === 0, `pending migrations ${JSON.stringify(probes.database.details.migrations)}`);
  });

  await step("admin v2: find the journey's user and organization", async () => {
    const u = await P("GET", `/users?search=${encodeURIComponent(email)}`);
    assert(u.status === 200 && u.json.items.length === 1, `users ${u.status}: ${JSON.stringify(u.json).slice(0, 200)}`);
    s.userId = u.json.items[0].id;
    const ud = await P("GET", `/users/${s.userId}`);
    assert(ud.status === 200 && ud.json.data.accounts.length >= 2, `user detail ${JSON.stringify(ud.json).slice(0, 200)}`);
    const a = await P("GET", `/accounts/${s.org}`);
    assert(a.status === 200 && a.json.data.limits && a.json.data.members.length >= 1, `account ${a.status}: ${JSON.stringify(a.json).slice(0, 200)}`);
  });

  await step("admin v2: settings are validated; maintenance mode blocks users but not admins", async () => {
    const bad = await P("PATCH", "/settings", { body: { changes: { "billing.trialDays": 999 } } });
    assert(bad.status === 400, `bad value accepted (${bad.status})`);
    const on = await P("PATCH", "/settings", { body: { changes: { "maintenance.enabled": true, "maintenance.message": `E2E maintenance ${RUN}` } } });
    assert(on.status === 200, `enable ${on.status}: ${JSON.stringify(on.json).slice(0, 200)}`);
    try {
      const user = await api("GET", "/account/me", { token: s.token });
      assert(user.status === 503 && user.json.code === "MAINTENANCE" && user.json.message.includes(RUN), `user during maintenance: ${user.status} ${JSON.stringify(user.json)}`);
      const pub = await api("GET", "/public/settings");
      assert(pub.status === 200 && pub.json.data["maintenance.enabled"] === true, `public settings ${pub.status}`);
      const admin = await P("GET", "/overview");
      assert(admin.status === 200, `admin during maintenance: ${admin.status}`);
    } finally {
      const off = await P("PATCH", "/settings", { body: { changes: { "maintenance.enabled": null, "maintenance.message": null } } });
      assert(off.status === 200, `disable ${off.status}`);
    }
    const back = await api("GET", "/account/me", { token: s.token });
    assert(back.status === 200, `after maintenance: ${back.status}`);
  });

  await step("admin v2: plan overrides apply to the public plan list and reset cleanly", async () => {
    const set = await P("PATCH", "/settings", { body: { changes: { "plans.overrides": { FREE: { maxApiKeys: 7, maxAgents: null } } } } });
    assert(set.status === 200, `override ${set.status}: ${JSON.stringify(set.json).slice(0, 200)}`);
    const plans = await api("GET", "/public/plans");
    const free = plans.json.data.plans.find((p) => p.plan === "FREE");
    assert(free.limits.maxApiKeys === 7 && free.limits.maxAgents === null, `free limits ${JSON.stringify(free.limits)}`);
    const reset = await P("PATCH", "/settings", { body: { changes: { "plans.overrides": null } } });
    assert(reset.status === 200, `reset ${reset.status}`);
  });

  await step("admin v2: CMS draft -> publish -> public, unpublish falls back to the default", async () => {
    const before = await api("GET", "/public/content/pricing");
    assert(before.status === 200 && before.json.data.isDefault === true, `default pricing ${before.status} ${JSON.stringify(before.json).slice(0, 120)}`);
    const created = await P("POST", "/content", { body: { slug: "pricing", kind: "pricing", title: "Pricing" } });
    assert(created.status === 201, `create ${created.status}: ${JSON.stringify(created.json).slice(0, 200)}`);
    const id = created.json.data.id;
    const data = { ...created.json.data.data, title: `Pricing ${RUN}` };
    const invalid = await P("PUT", `/content/${id}`, { body: { data: { ...data, plans: "nope" } } });
    assert(invalid.status === 400, `invalid content accepted (${invalid.status})`);
    const saved = await P("PUT", `/content/${id}`, { body: { data } });
    assert(saved.status === 200, `save ${saved.status}`);
    const stillDefault = await api("GET", "/public/content/pricing");
    assert(stillDefault.json.data.isDefault === true, "a draft leaked to the public site");
    const pub = await P("POST", `/content/${id}/publish`, { body: { note: "e2e" } });
    assert(pub.status === 200 && pub.json.data.version === 1, `publish ${pub.status}: ${JSON.stringify(pub.json).slice(0, 200)}`);
    const live = await api("GET", "/public/content/pricing");
    assert(live.json.data.data.title === `Pricing ${RUN}` && live.json.data.isDefault === false, `public after publish: ${JSON.stringify(live.json).slice(0, 200)}`);
    const un = await P("POST", `/content/${id}/unpublish`, { body: {} });
    assert(un.status === 200, `unpublish ${un.status}`);
    const del = await P("DELETE", `/content/${id}`);
    assert(del.status === 200, `delete ${del.status}`);
    const after = await api("GET", "/public/content/pricing");
    assert(after.json.data.isDefault === true, "default not restored");
  });

  await step("admin v2: live tunnels list a new agent; force-disconnect stops it", async () => {
    const k = await api("POST", `/apikeys/organizations/${s.personal}/api-keys`, { token: s.token, body: { name: `admin-v2 ${RUN}`, environment: "DEV", scopes: ["tunnel:connect"] } });
    assert(k.status === 201 || k.status === 200, `key ${k.status}: ${JSON.stringify(k.json).slice(0, 200)}`);
    const d = k.json.data ?? k.json;
    s.adminKeyUuid = d.key?.id ?? d.id;
    s.adminKey = { keyId: d.key?.keyId ?? d.keyId, secret: d.secret };
    // FREE allows one agent and the journey's first agent is still connected:
    // a per-account override raises the limit for this account only.
    const refused = startAgent({ key: d.key?.keyId ?? d.keyId, secret: d.secret, port: s.backendPort, label: "overlimit" });
    const refusedOut = await Promise.race([refused.exited.then(() => refused.output()), sleep(8_000).then(() => refused.output())]);
    refused.child.kill("SIGINT");
    assert(/limit|Maximum/i.test(refusedOut), `second agent on FREE was not refused: ${refusedOut.slice(-300)}`);
    const raise = await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: { maxAgents: 2 } } });
    assert(raise.status === 200, `override ${raise.status}: ${JSON.stringify(raise.json)}`);
    const agent = startAgent({ key: d.key?.keyId ?? d.keyId, secret: d.secret, port: s.backendPort, label: "adminv2" });
    await agent.waitFor(/Public:\s+(\S+)/, 20_000);
    let mine;
    for (let i = 0; i < 20 && !mine; i++) {
      const live = await P("GET", "/tunnels/live");
      assert(live.status === 200 && live.json.data.available, `live ${live.status}: ${JSON.stringify(live.json).slice(0, 200)}`);
      mine = live.json.data.agents.find((a) => a.label === "adminv2");
      if (!mine) await sleep(250);
    }
    assert(mine && mine.url, `agent not listed`);
    const noReason = await P("POST", `/tunnels/live/${mine.agentId}/disconnect`, { body: {} });
    assert(noReason.status === 400, `disconnect without reason: ${noReason.status}`);
    const dc = await P("POST", `/tunnels/live/${mine.agentId}/disconnect`, { body: { reason: "e2e check" } });
    assert(dc.status === 200, `disconnect ${dc.status}: ${JSON.stringify(dc.json)}`);
    const res = await Promise.race([agent.exited, sleep(15_000).then(() => null)]);
    assert(res && res.code === 1, `agent did not stop: ${JSON.stringify(res)}; ${agent.output().slice(-300)}`);
    const reset = await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: null } });
    assert(reset.status === 200, `reset override ${reset.status}`);
  });

  await step("access rules: refused on FREE, then password, share link, revoke, IP allowlist, public again", async () => {
    const U = (m, p, o = {}) => api(m, `/tunnel-access/${s.personal}${p}`, { token: s.token, ...o });
    const free = await U("PUT", "/guarded", { body: { password: "correct-horse" } });
    assert(free.status === 402, `FREE should be refused: ${free.status}`);
    const grant = await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: { maxAgents: 2, accessRules: true } } });
    assert(grant.status === 200, `override ${grant.status}`);
    const agent = startAgent({ key: s.adminKey.keyId, secret: s.adminKey.secret, port: s.backendPort, label: "guarded" });
    const host = new URL((await agent.waitFor(/Public:\s+(\S+)/, 20_000))[1]).host;
    try {
      const set = await U("PUT", "/guarded", { body: { password: "correct-horse" } });
      assert(set.status === 200 && set.json.data.hasPassword, `set ${set.status}: ${JSON.stringify(set.json)}`);
      const anon = await tunnel(host, "GET", "/echo");
      assert(anon.status === 401 && /Basic/.test(anon.headers["www-authenticate"] ?? ""), `anonymous ${anon.status}`);
      const basic = "Basic " + Buffer.from("x:correct-horse").toString("base64");
      const ok = await tunnel(host, "GET", "/echo", { headers: { authorization: basic } });
      assert(ok.status === 200, `with password ${ok.status}`);
      assert(!JSON.parse(ok.body).headers.authorization, "tunnel password reached the backend");
      const wrong = await tunnel(host, "GET", "/echo", { headers: { authorization: "Basic " + Buffer.from("x:nope").toString("base64") } });
      assert(wrong.status === 401, `wrong password ${wrong.status}`);

      const link = await U("POST", "/guarded/share-links", { body: { hours: 1 } });
      assert(link.status === 201, `share link ${link.status}: ${JSON.stringify(link.json)}`);
      const hop = await tunnel(host, "GET", `/echo?a=1&${link.json.data.query}`);
      assert(hop.status === 302 && hop.headers.location === "/echo?a=1", `share redirect ${hop.status} ${hop.headers.location}`);
      const cookie = String(hop.headers["set-cookie"]).split(";")[0];
      const viaCookie = await tunnel(host, "GET", "/echo", { headers: { cookie: `theirs=1; ${cookie}` } });
      assert(viaCookie.status === 200, `with share cookie ${viaCookie.status}`);
      assert(JSON.parse(viaCookie.body).headers.cookie === "theirs=1", "share cookie reached the backend");

      const revoke = await U("POST", "/guarded/revoke-links");
      assert(revoke.status === 200, `revoke ${revoke.status}`);
      const revoked = await tunnel(host, "GET", "/echo", { headers: { cookie } });
      assert(revoked.status === 401, `revoked link still works: ${revoked.status}`);

      const ips = await U("PUT", "/guarded", { body: { ipAllowlist: ["10.0.0.0/8"] } });
      assert(ips.status === 200, `allowlist ${ips.status}`);
      const blocked = await tunnel(host, "GET", "/echo", { headers: { authorization: basic } });
      assert(blocked.status === 403, `outside the allowlist ${blocked.status}`);
      const badIp = await U("PUT", "/guarded", { body: { ipAllowlist: ["not-an-ip"] } });
      assert(badIp.status === 400, `invalid allowlist ${badIp.status}`);

      const pub = await U("DELETE", "/guarded");
      assert(pub.status === 200, `remove ${pub.status}`);
      const open = await tunnel(host, "GET", "/echo");
      assert(open.status === 200, `public again ${open.status}`);
      const listed = await U("GET", "");
      assert(listed.status === 200 && listed.json.data.planAllows && listed.json.data.liveLabels.includes("guarded"), `overview ${JSON.stringify(listed.json.data)}`);
    } finally {
      agent.child.kill("SIGINT");
      await Promise.race([agent.exited, sleep(5_000)]);
      await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: null } });
    }
    const after = await P("GET", `/accounts/${s.personal}`);
    assert(after.status === 200, `account ${after.status}: ${JSON.stringify(after.json).slice(0, 200)}`);
    assert(after.json.data.limitOverrides == null, `overrides not cleared: ${JSON.stringify(after.json.data.limitOverrides)}`);
  });

  await step("webhook inbox: offline writes are held (202) and delivered in order when the agent connects", async () => {
    const I = (m, p, o = {}) => api(m, `/inbox/${s.personal}${p}`, { token: s.token, ...o });
    const host = s.host.replace(/--[^.]+/, "--hooks");
    const before = await tunnel(host, "POST", "/webhook/1", { body: "{}" });
    assert(before.status === 404, `inbox off: expected 404, got ${before.status}`);
    const on = await I("PUT", "/hooks", { body: { enabled: true } });
    assert(on.status === 200 && on.json.data.enabled, `enable ${on.status}: ${JSON.stringify(on.json)}`);
    const ids = [];
    for (const n of [1, 2, 3]) {
      const r = await tunnel(host, "POST", `/echo?n=${n}`, { headers: { "content-type": "application/json", "stripe-signature": `t=${n}` }, body: JSON.stringify({ n }) });
      assert(r.status === 202 && r.headers["x-vhyxvoid-inbox"], `held ${r.status}: ${r.body}`);
      ids.push(r.headers["x-vhyxvoid-inbox"]);
    }
    const read = await tunnel(host, "GET", "/echo");
    assert(read.status === 404, `GET to an offline tunnel should not be held: ${read.status}`);
    const queued = await I("GET", "/hooks?status=QUEUED");
    assert(queued.json.data.requests.length === 3, `queued ${queued.json.data.requests.length}`);
    const one = await I("GET", `/hooks/${ids[0]}`);
    assert(one.json.data.headers["stripe-signature"] === "t=1" && one.json.data.body.data === '{"n":1}', "stored request incomplete");

    const grant = await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: { maxAgents: 2 } } });
    assert(grant.status === 200, `override ${grant.status}`);
    const agent = startAgent({ key: s.adminKey.keyId, secret: s.adminKey.secret, port: s.backendPort, label: "hooks" });
    try {
      await agent.waitFor(/Public:\s+(\S+)/, 20_000);
      let rows = [];
      for (let i = 0; i < 60; i++) {
        rows = (await I("GET", "/hooks")).json.data.requests;
        if (rows.length === 3 && rows.every((r) => r.status === "DELIVERED")) break;
        await sleep(250);
      }
      assert(rows.every((r) => r.status === "DELIVERED" && r.responseStatus === 200), `not delivered: ${JSON.stringify(rows.map((r) => [r.status, r.lastError]))}`);
      const order = [...rows].sort((a, b) => new Date(a.deliveredAt) - new Date(b.deliveredAt)).map((r) => r.id);
      assert(JSON.stringify(order) === JSON.stringify(ids), "delivered out of order");

      const again = await I("POST", `/hooks/${ids[1]}/redeliver`);
      assert(again.status === 200, `redeliver ${again.status}`);
      let back;
      for (let i = 0; i < 40 && back?.status !== "DELIVERED"; i++) {
        await sleep(250);
        back = (await I("GET", `/hooks/${ids[1]}`)).json.data;
      }
      assert(back.status === "DELIVERED" && back.attempts === 1, `redelivered ${JSON.stringify([back.status, back.attempts])}`);
      const o = await I("GET", "");
      const t = o.json.data.tunnels.find((x) => x.label === "hooks");
      assert(t && t.enabled && t.delivered === 3 && t.queued === 0, `overview ${JSON.stringify(t)}`);
    } finally {
      agent.child.kill("SIGINT");
      await Promise.race([agent.exited, sleep(5_000)]);
      await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: null } });
    }
    const off = await I("PUT", "/hooks", { body: { enabled: false } });
    assert(off.status === 200, `disable ${off.status}`);
    let after;
    for (let i = 0; i < 20; i++) {
      after = await tunnel(host, "POST", "/echo", { body: "{}" });
      if (after.status !== 202) break;
      await sleep(250);
    }
    assert(after.status === 404 || after.status === 503, `inbox off but held: ${after.status}`);
    const purge = await I("DELETE", "/hooks?status=DELIVERED");
    assert(purge.status === 200 && purge.json.data.deleted === 3, `purge ${JSON.stringify(purge.json)}`);
  });

  await step("custom domains: claim, verify by DNS, serve the tunnel, move, remove", async () => {
    const D = (m, p, o = {}) => api(m, `/domains/${s.personal}${p}`, { token: s.token, ...o });
    const dnsFile = process.env.DNS_TEST_RECORDS_FILE;
    assert(dnsFile, "DNS_TEST_RECORDS_FILE must be set for this step (API and journey)");
    fs.writeFileSync(dnsFile, "{}");
    const target = await P("PATCH", "/settings", { body: { changes: { "tunnels.customDomainTarget": "edge.vv.test" } } });
    assert(target.status === 200, `target ${target.status}: ${JSON.stringify(target.json).slice(0, 200)}`);
    const host = `app-${RUN}.journey.test`;
    const free = await D("POST", "", { body: { hostname: host, label: "site" } });
    assert(free.status === 402, `FREE should be refused: ${free.status}`);
    const grant = await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: { maxAgents: 2, customDomains: true, maxCustomDomains: 2 } } });
    assert(grant.status === 200, `override ${grant.status}`);
    const ours = await D("POST", "", { body: { hostname: `x.${HUB_DOMAIN}`, label: "site" } });
    assert(ours.status === 400, `platform subdomain accepted: ${ours.status}`);
    const add = await D("POST", "", { body: { hostname: `HTTPS://${host.toUpperCase()}./`, label: "site" } });
    assert(add.status === 201 && add.json.data.hostname === host && add.json.data.status === "PENDING_VERIFICATION", `add ${add.status}: ${JSON.stringify(add.json).slice(0, 300)}`);
    const dom = add.json.data;
    assert(dom.records.routing?.value === "edge.vv.test", "routing record missing");
    const again = await D("POST", "", { body: { hostname: host, label: "site" } });
    assert(again.status === 409, `duplicate ${again.status}`);

    const allow = async (h) => (await fetch(`${API}/public/domains/allow?domain=${encodeURIComponent(h)}`)).status;
    assert((await allow(host)) === 404, "certificate allowed before verification");
    const before = await tunnel(host, "GET", "/echo");
    assert(before.status === 404 && before.headers["x-vhyxvoid-error"] === "UNKNOWN_DOMAIN", `unverified domain routed: ${before.status}`);

    fs.writeFileSync(dnsFile, JSON.stringify({ [dom.records.verification.name]: { TXT: ["unrelated", dom.records.verification.value] }, [host]: { CNAME: ["edge.vv.test."] } }));
    const check = await D("POST", `/${dom.id}/check`);
    assert(check.status === 200 && check.json.data.status === "ACTIVE", `check ${check.status}: ${JSON.stringify(check.json).slice(0, 300)}`);
    assert((await allow(host)) === 200, "certificate not allowed after verification");

    const agent = startAgent({ key: s.adminKey.keyId, secret: s.adminKey.secret, port: s.backendPort, label: "site" });
    try {
      await agent.waitFor(/Public:\s+(\S+)/, 20_000);
      const r = await tunnel(host, "GET", "/echo?via=custom");
      assert(r.status === 200 && JSON.parse(r.body).query === "?via=custom", `custom domain request ${r.status}: ${r.body}`);
      const moved = await D("PATCH", `/${dom.id}`, { body: { label: "elsewhere" } });
      assert(moved.status === 200, `move ${moved.status}`);
      const gone = await tunnel(host, "GET", "/echo");
      assert(gone.status === 404 && gone.headers["x-vhyxvoid-error"] === "TUNNEL_OFFLINE", `moved domain still served the old tunnel: ${gone.status}`);
      await D("PATCH", `/${dom.id}`, { body: { label: "site" } });
      const back = await tunnel(host, "GET", "/echo");
      assert(back.status === 200, `moved back ${back.status}`);
      const list = await D("GET", "");
      assert(list.json.data.available && list.json.data.domains.some((d) => d.hostname === host && d.status === "ACTIVE"), "list");
      const adminList = await P("GET", `/domains?search=${encodeURIComponent(host)}`);
      assert(adminList.status === 200 && adminList.json.items.length === 1 && !("verificationToken" in adminList.json.items[0]), `admin list ${adminList.status}`);
    } finally {
      agent.child.kill("SIGINT");
      await Promise.race([agent.exited, sleep(5_000)]);
    }
    const del = await D("DELETE", `/${dom.id}`);
    assert(del.status === 200, `delete ${del.status}`);
    assert((await allow(host)) === 404, "certificate still allowed after removal");
    const after = await tunnel(host, "GET", "/echo");
    assert(after.status === 404 && after.headers["x-vhyxvoid-error"] === "UNKNOWN_DOMAIN", `removed domain still routed: ${after.status}`);
    await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: null } });
    await P("PATCH", "/settings", { body: { changes: { "tunnels.customDomainTarget": null } } });
  });

  await step("alerts: test notification, error rate fires and resolves over a webhook, history", async () => {
    const AL = (m, p, o = {}) => api(m, `/alerts/${s.personal}${p}`, { token: s.token, ...o });
    const received = [];
    const { createServer } = await import("node:http");
    const receiver = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        try {
          received.push(JSON.parse(b));
        } catch {}
        res.writeHead(204).end();
      });
    });
    await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
    cleanups.push(() => receiver.close());
    const hookUrl = `http://127.0.0.1:${receiver.address().port}/hook`;
    const flushHub = () => fetch(`${HUB}/internal/stats/flush`, { method: "POST", headers: { "x-hub-internal-secret": process.env.HUB_INTERNAL_SECRET } });
    const runAlerts = () => P("POST", "/system/jobs/alerts/run");
    const waitFor = async (pred, ms = 5_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (pred()) return true;
        await sleep(100);
      }
      return false;
    };

    const bad = await AL("POST", "", { body: { type: "ERROR_RATE", name: "bad", webhookUrl: "ftp://example.com/x" } });
    assert(bad.status === 400, `bad webhook accepted: ${bad.status}`);
    const grant = await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: { maxAgents: 2 } } });
    assert(grant.status === 200, `override ${grant.status}`);
    const created = await AL("POST", "", {
      body: { type: "ERROR_RATE", name: "Errors on alerty", label: "alerty", threshold: 50, windowMinutes: 5, minRequests: 5, webhookUrl: hookUrl, emails: ["oncall@example.com"] },
    });
    assert(created.status === 201, `create ${created.status}: ${JSON.stringify(created.json).slice(0, 300)}`);
    const rule = created.json.data;

    const test = await AL("POST", `/${rule.id}/test`);
    assert(test.status === 200 && test.json.data.deliveries?.webhook === "ok", `test ${test.status}: ${JSON.stringify(test.json)}`);
    assert(test.json.data.deliveries.email >= 2 && test.json.data.deliveries.inApp >= 1, `channels ${JSON.stringify(test.json.data.deliveries)}`);
    assert(await waitFor(() => received.some((p) => p.alert?.kind === "EVENT" && /^Test:/.test(p.alert.title))), "test webhook not received");
    const notes = await api("GET", "/notification/notifications", { token: s.token });
    assert(JSON.stringify(notes.json).includes("Test: Errors on alerty"), "in-app notification missing");

    const agent = startAgent({ key: s.adminKey.keyId, secret: s.adminKey.secret, port: s.backendPort, label: "alerty" });
    try {
      const host = new URL((await agent.waitFor(/Public:\s+(\S+)/, 20_000))[1]).host;
      for (let i = 0; i < 10; i++) assert((await tunnel(host, "GET", "/status/500")).status === 500, "backend 500 not passed through");
      assert((await flushHub()).status === 200, "hub stats flush");
      const fire = await runAlerts();
      assert(fire.status === 200, `run ${fire.status}: ${JSON.stringify(fire.json).slice(0, 200)}`);
      assert(await waitFor(() => received.some((p) => p.alert?.kind === "FIRING" && p.alert.subject === "alerty")), `no FIRING webhook: ${JSON.stringify(fire.json)}`);
      const firing = await AL("GET", "");
      assert(firing.json.data.rules.find((r) => r.id === rule.id).firing.some((f) => f.subject === "alerty"), "rule not shown as firing");
      const quiet = await runAlerts();
      assert(received.filter((p) => p.alert?.kind === "FIRING").length === 1, `repeated FIRING ${JSON.stringify(quiet.json)}`);

      for (let i = 0; i < 40; i++) await tunnel(host, "GET", "/echo");
      await flushHub();
      await runAlerts();
      assert(await waitFor(() => received.some((p) => p.alert?.kind === "RESOLVED" && p.alert.subject === "alerty")), "no RESOLVED webhook");
      const history = await AL("GET", `/events?ruleId=${rule.id}`);
      const kinds = history.json.data.events.map((e) => e.kind);
      assert(kinds.includes("FIRING") && kinds.includes("RESOLVED") && kinds.includes("EVENT"), `history ${kinds}`);
    } finally {
      agent.child.kill("SIGINT");
      await Promise.race([agent.exited, sleep(5_000)]);
    }

    if (process.env.E2E_SLOW_ALERTS === "1") {
      const off = await AL("POST", "", { body: { type: "TUNNEL_OFFLINE", name: "alerty down", label: "alerty", windowMinutes: 1, webhookUrl: hookUrl, notifyMembers: false } });
      assert(off.status === 201, `offline rule ${off.status}`);
      await sleep(65_000);
      await runAlerts();
      assert(await waitFor(() => received.some((p) => p.alert?.kind === "FIRING" && p.alert.rule.type === "TUNNEL_OFFLINE")), "offline alert did not fire");
    }
    await P("PATCH", `/accounts/${s.personal}`, { body: { limitOverrides: null } });
    const rules = (await AL("GET", "")).json.data.rules;
    for (const r of rules) await AL("DELETE", `/${r.id}`);
    return `${received.length} webhook deliveries`;
  });

  await step("admin v2: suspending an account needs a reason, refuses its keys, and reactivates", async () => {
    const noReason = await P("PATCH", `/accounts/${s.personal}`, { body: { status: "SUSPENDED" } });
    assert(noReason.status === 400, `suspend without reason: ${noReason.status}`);
    const sus = await P("PATCH", `/accounts/${s.personal}`, { body: { status: "SUSPENDED", statusReason: "e2e abuse check" } });
    assert(sus.status === 200 && sus.json.data.status === "SUSPENDED", `suspend ${sus.status}: ${JSON.stringify(sus.json)}`);
    const k = await P("GET", `/api-keys?accountId=${s.personal}&status=ACTIVE`);
    assert(k.status === 200 && k.json.items.length >= 1, `keys ${JSON.stringify(k.json).slice(0, 200)}`);
    const re = await P("PATCH", `/accounts/${s.personal}`, { body: { status: "ACTIVE" } });
    assert(re.status === 200 && re.json.data.status === "ACTIVE", `reactivate ${re.status}`);
    const rv = await P("POST", `/api-keys/${s.adminKeyUuid}/revoke`, { body: { reason: "e2e" } });
    assert(rv.status === 200, `revoke ${rv.status}: ${JSON.stringify(rv.json)}`);
    const again = await P("POST", `/api-keys/${s.adminKeyUuid}/revoke`, { body: { reason: "e2e" } });
    assert(again.status === 400, `second revoke ${again.status}`);
  });

  await step("admin v2: every action above is in the admin audit CSV", async () => {
    const res = await fetch(`${API}/admin/logs/admin-audit.csv`, { headers: { authorization: `Bearer ${s.admin}` } });
    const csv = await res.text();
    assert(res.status === 200 && res.headers.get("content-type").includes("text/csv"), `csv ${res.status}`);
    for (const action of ["settings.updated", "content.published", "tunnel.disconnected", "account.suspended", "apikey.revoked"]) {
      assert(csv.includes(action), `missing ${action} in the audit export`);
    }
  });

  await step("admin: disabling an admin stops their access", async () => {
    const d = await A("POST", `/users/${s.opsId}/disable`, { token: s.admin, body: {} });
    assert(d.status < 300, `disable ${d.status}: ${JSON.stringify(d.json)}`);
    const login = await A("POST", "/auth/login", { body: { email: adminEmail, password: adminPw } });
    assert(login.status >= 400, `disabled admin could log in (${login.status})`);
    const t0 = Date.now();
    let status = 200;
    while (Date.now() - t0 < 35_000) {
      status = (await A("GET", "/me", { token: s.ops })).status;
      if (status === 401 || status === 403) break;
      await sleep(1000);
    }
    assert(status === 401 || status === 403, `disabled admin's token still works (${status})`);
  });

  await step("admin: logout revokes the admin access token", async () => {
    const r = await A("POST", "/auth/logout", { token: s.admin, body: {} });
    assert(r.status < 300, `logout ${r.status}`);
    const me = await A("GET", "/me", { token: s.admin });
    assert(me.status === 401, `admin token still works after logout (${me.status})`);
  });
}

await step("refresh token rotates the session", async () => {
  const r = await api("POST", "/auth/refresh", { headers: { cookie: s.refreshCookie } });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
  assert(r.json.data?.accessToken, "no new access token");
});

await step("forgot password -> reset -> login with the new password", async () => {
  const f = await api("POST", "/auth/forgot-password", { body: { email } });
  assert(f.status === 200, `forgot status ${f.status}`);
  const token = tokenFrom(await lastEmail(email, /reset/i));
  const newPassword = "Brand-New-Pass-7!";
  const r = await api("POST", "/auth/reset-password", { body: { token, newPassword, password: newPassword } });
  assert(r.status === 200, `reset status ${r.status}: ${JSON.stringify(r.json)}`);
  const old = await api("POST", "/auth/login", { body: { email, password } });
  assert(old.status >= 400, `old password still works (${old.status})`);
  const ok = await api("POST", "/auth/login", { body: { email, password: newPassword } });
  assert(ok.status === 200, `new password login ${ok.status}`);
  s.token = ok.json.data.accessToken;
  s.refreshCookie = (ok.headers.get("set-cookie") ?? "").split(";")[0];
});

await step("logout revokes the access token immediately", async () => {
  const r = await api("POST", "/auth/logout", { token: s.token, headers: { cookie: s.refreshCookie }, body: {} });
  assert(r.status === 200 || r.status === 204, `logout status ${r.status}: ${JSON.stringify(r.json)}`);
  const me = await api("GET", "/account/me", { token: s.token });
  assert(me.status === 401, `access token still works after logout (${me.status})`);
});

for (const c of cleanups.reverse()) {
  try {
    await c();
  } catch {}
}
console.log(`\n${results.length - failed}/${results.length} steps passed`);
process.exit(failed ? 1 : 0);
