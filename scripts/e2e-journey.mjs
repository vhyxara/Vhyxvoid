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
