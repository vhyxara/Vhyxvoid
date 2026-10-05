#!/usr/bin/env node
// Local stand-in for Upstash's Redis REST API, backed by a plain Redis.
// For local development, CI and scripts/e2e-journey.mjs only: no auth beyond
// a bearer token match, no TLS. Never run it in production.
//
//   REDIS_URL=redis://127.0.0.1:6379 PORT=8079 TOKEN=local node scripts/upstash-rest-standin.mjs
//   UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079 UPSTASH_REDIS_REST_TOKEN=local
//
// Supports POST / (one command), /pipeline and /multi-exec (arrays of
// commands), and the `Upstash-Encoding: base64` response encoding that
// @upstash/redis requests by default.
import http from "node:http";
import net from "node:net";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const port = Number(process.env.PORT ?? 8079);
const token = process.env.TOKEN ?? "local";

// ── Minimal RESP client: one connection per request batch, replies in order ──
function encode(args) {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const b = Buffer.from(String(a));
    out += `$${b.length}\r\n${b.toString("binary")}\r\n`;
  }
  return Buffer.from(out, "binary");
}

function parse(buf, i = 0) {
  const type = String.fromCharCode(buf[i]);
  const end = buf.indexOf("\r\n", i);
  if (end === -1) return null;
  const line = buf.subarray(i + 1, end).toString();
  const next = end + 2;
  if (type === "+") return { value: line, next };
  if (type === "-") return { value: { error: line }, next };
  if (type === ":") return { value: Number(line), next };
  if (type === "$") {
    const len = Number(line);
    if (len === -1) return { value: null, next };
    if (buf.length < next + len + 2) return null;
    return { value: buf.subarray(next, next + len).toString(), next: next + len + 2 };
  }
  if (type === "*") {
    const n = Number(line);
    if (n === -1) return { value: null, next };
    const arr = [];
    let at = next;
    for (let k = 0; k < n; k++) {
      const r = parse(buf, at);
      if (!r) return null;
      arr.push(r.value);
      at = r.next;
    }
    return { value: arr, next: at };
  }
  throw new Error(`bad RESP type ${type}`);
}

function run(commands) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(redisUrl.port || 6379), redisUrl.hostname);
    const replies = [];
    let buf = Buffer.alloc(0);
    sock.on("connect", () => {
      const pre = redisUrl.password ? [encode(["AUTH", decodeURIComponent(redisUrl.password)])] : [];
      if (pre.length) commands = [["AUTH", decodeURIComponent(redisUrl.password)], ...commands];
      sock.write(Buffer.concat(commands.map(encode)));
    });
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let r;
      while (buf.length && (r = parse(buf))) {
        replies.push(r.value);
        buf = buf.subarray(r.next);
      }
      if (replies.length === commands.length) {
        sock.end();
        resolve(redisUrl.password ? replies.slice(1) : replies);
      }
    });
    sock.on("error", reject);
  });
}

const b64 = (v) =>
  v === null || typeof v === "number" ? v : Array.isArray(v) ? v.map(b64) : Buffer.from(String(v)).toString("base64");

const wrap = (v, base64) =>
  v && typeof v === "object" && !Array.isArray(v) && "error" in v ? { error: v.error } : { result: base64 ? b64(v) : v };

http
  .createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const base64 = String(req.headers["upstash-encoding"] ?? "").toLowerCase() === "base64";
        const parsed = body ? JSON.parse(body) : [];
        const path = new URL(req.url, "http://x").pathname;
        let payload;
        if (path === "/pipeline") {
          payload = (await run(parsed)).map((r) => wrap(r, base64));
        } else if (path === "/multi-exec") {
          const replies = await run([["MULTI"], ...parsed, ["EXEC"]]);
          payload = (replies.at(-1) ?? []).map((r) => wrap(r, base64));
        } else {
          const cmd = Array.isArray(parsed) ? parsed : path.slice(1).split("/").map(decodeURIComponent);
          payload = wrap((await run([cmd]))[0], base64);
        }
        res.writeHead("error" in (payload ?? {}) ? 400 : 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(err) }));
      }
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`[upstash-standin] http://127.0.0.1:${port} -> ${redisUrl.host}`));
