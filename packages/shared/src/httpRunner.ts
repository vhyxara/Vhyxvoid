// packages/shared/src/httpRunner.ts
//
// Sends a BuiltRequest (apiClient.ts) over node's http/https and measures it:
// DNS, connect, TLS, first byte, download, total. A fresh connection per
// request (no keep-alive pool) so the timings mean the same thing every time.
// The response is decompressed (gzip, deflate, br), cut at maxBytes, and
// returned as text or base64. Redirects are followed only when asked.
//
// The platform's runner passes a `lookup` that refuses private addresses (an
// SSRF guard checked at connect time); the CLI passes none, so `vhyxvoid test`
// can reach localhost in CI.

import http from "http";
import https from "https";
import type dns from "dns";
import zlib from "zlib";
import type { ApiResponse, BuiltRequest } from "./apiClient";
import { API_CLIENT_BOUNDS } from "./apiClient";

export type LookupFn = (hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => void;

export interface SendOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** How many redirects to follow (0 = return the 3xx). */
  followRedirects?: number;
  lookup?: LookupFn;
  /** Checked before each hop (the first URL and every redirect target); return an error message to refuse. */
  checkUrl?: (url: URL) => string | undefined;
  /** Accept self-signed certificates (CLI --insecure). */
  insecure?: boolean;
  userAgent?: string;
}

export class SendError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const TEXT_TYPE = /^(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|x-yaml|problem\+json|ld\+json|x-ndjson|csv))|^image\/svg\+xml/i;

function looksLikeText(buf: Buffer): boolean {
  const n = Math.min(buf.length, 1024);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return !buf.subarray(0, n).toString("utf8").includes("�");
}

function readable(err: NodeJS.ErrnoException): SendError {
  const code = err.code ?? "ERROR";
  const msg: Record<string, string> = {
    ENOTFOUND: "The host name doesn't resolve (DNS lookup failed)",
    EAI_AGAIN: "DNS lookup timed out; try again",
    ECONNREFUSED: "The server refused the connection (nothing listening on that port?)",
    ECONNRESET: "The server closed the connection",
    EHOSTUNREACH: "The host can't be reached",
    ENETUNREACH: "The network can't be reached",
    EPRIVATE: "That address is private; the API client sends to public addresses only",
    CERT_HAS_EXPIRED: "The server's TLS certificate has expired",
    DEPTH_ZERO_SELF_SIGNED_CERT: "The server uses a self-signed TLS certificate",
    SELF_SIGNED_CERT_IN_CHAIN: "The server's TLS certificate chain is self-signed",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The server's TLS certificate can't be verified",
    ERR_TLS_CERT_ALTNAME_INVALID: "The server's TLS certificate is for a different host",
    HPE_INVALID_CONSTANT: "The server didn't answer with HTTP",
  };
  return new SendError(msg[code] ? `${msg[code]} (${code})` : err.message, code);
}

interface Hop {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Buffer;
  truncated: boolean;
  timings: ApiResponse["timings"];
  httpVersion: string;
  remoteAddress?: string;
}

function once(url: URL, method: string, headers: [string, string][], body: Buffer | undefined, opts: Required<Pick<SendOptions, "timeoutMs" | "maxBytes">> & SendOptions): Promise<Hop> {
  const mod = url.protocol === "https:" ? https : http;
  const t0 = performance.now();
  const marks = { lookup: 0, connect: 0, secure: 0, sent: 0, first: 0 };
  const outHeaders: Record<string, string | string[]> = {};
  for (const [k, v] of headers) {
    const prev = outHeaders[k];
    outHeaders[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  if (!headers.some(([k]) => k.toLowerCase() === "user-agent")) outHeaders["User-Agent"] = opts.userAgent ?? "VhyxVoid-API-Client/1";
  if (!headers.some(([k]) => k.toLowerCase() === "accept")) outHeaders["Accept"] = "*/*";
  if (!headers.some(([k]) => k.toLowerCase() === "accept-encoding")) outHeaders["Accept-Encoding"] = "gzip, deflate, br";
  if (body) outHeaders["Content-Length"] = String(body.length);

  return new Promise<Hop>((resolve, reject) => {
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(e instanceof SendError ? e : readable(e as NodeJS.ErrnoException));
    };
    const req = mod.request(url, {
      method,
      headers: outHeaders,
      agent: false,
      lookup: opts.lookup as never,
      rejectUnauthorized: !opts.insecure,
      // Our own headers are validated; keep the server's as they come.
      insecureHTTPParser: false,
    });
    const timer = setTimeout(() => fail(new SendError(`No complete answer within ${Math.round(opts.timeoutMs / 1000)} s`, "ETIMEDOUT")), opts.timeoutMs);
    req.on("socket", (socket) => {
      socket.once("lookup", () => (marks.lookup = performance.now()));
      socket.once("connect", () => (marks.connect = performance.now()));
      socket.once("secureConnect", () => (marks.secure = performance.now()));
    });
    req.on("finish", () => (marks.sent = performance.now()));
    req.on("error", fail);
    req.on("response", (res) => {
      marks.first = performance.now();
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
      let stream: NodeJS.ReadableStream = res;
      if (method !== "HEAD" && res.statusCode !== 204 && res.statusCode !== 304) {
        const z = enc === "gzip" || enc === "x-gzip" ? zlib.createGunzip() : enc === "deflate" ? zlib.createInflate() : enc === "br" ? zlib.createBrotliDecompress() : null;
        if (z) {
          res.pipe(z);
          z.on("error", fail);
          stream = z;
        }
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const end = performance.now();
        const start = t0;
        const dnsEnd = marks.lookup || start;
        const connectEnd = marks.connect || dnsEnd;
        const tlsEnd = marks.secure || connectEnd;
        const sent = Math.max(marks.sent || tlsEnd, tlsEnd);
        const rawHeaders: [string, string][] = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) rawHeaders.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
        resolve({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? "",
          headers: rawHeaders,
          body: Buffer.concat(chunks),
          truncated,
          httpVersion: res.httpVersion,
          remoteAddress: res.socket?.remoteAddress ?? undefined,
          timings: {
            dns: marks.lookup ? round(dnsEnd - start) : 0,
            connect: marks.connect ? round(connectEnd - dnsEnd) : 0,
            tls: marks.secure ? round(tlsEnd - connectEnd) : 0,
            firstByte: round(marks.first - Math.min(sent, marks.first)),
            download: round(end - marks.first),
            total: round(end - start),
          },
        });
        req.destroy();
      };
      stream.on("data", (c: Buffer) => {
        if (truncated) return;
        if (size + c.length > opts.maxBytes) {
          chunks.push(c.subarray(0, opts.maxBytes - size));
          size = opts.maxBytes;
          truncated = true;
          finish();
          res.destroy();
          return;
        }
        size += c.length;
        chunks.push(c);
      });
      stream.on("end", finish);
      res.on("error", fail);
      res.on("aborted", () => (truncated ? finish() : fail(new SendError("The server closed the connection mid-answer", "ECONNRESET"))));
    });
    req.end(body);
  });
}

const round = (n: number) => Math.max(0, Math.round(n * 10) / 10);

export async function sendHttp(built: BuiltRequest, options: SendOptions = {}): Promise<ApiResponse> {
  const opts = { timeoutMs: API_CLIENT_BOUNDS.timeoutMs, maxBytes: API_CLIENT_BOUNDS.responseBytes, ...options };
  let url: URL;
  try {
    url = new URL(built.url);
  } catch {
    throw new SendError("Not a valid URL", "EINVALIDURL");
  }
  let method: string = built.method;
  let headers = built.headers;
  let body = built.body;
  const redirects: string[] = [];
  const started = performance.now();
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new SendError(`Can't follow a redirect to ${url.protocol}`, "EPROTOCOL");
    const refusal = opts.checkUrl?.(url);
    if (refusal) throw new SendError(refusal, "EPRIVATE");
    const r = await once(url, method, headers, body, opts);
    const location = r.headers.find(([k]) => k.toLowerCase() === "location")?.[1];
    if (r.status >= 300 && r.status < 400 && location && hop < (opts.followRedirects ?? 0)) {
      const next = new URL(location, url);
      redirects.push(url.toString());
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && method !== "GET" && method !== "HEAD")) {
        method = "GET";
        body = undefined;
        headers = headers.filter(([k]) => k.toLowerCase() !== "content-type");
      }
      // Credentials don't follow a redirect to another origin.
      if (next.origin !== url.origin) headers = headers.filter(([k]) => !["authorization", "cookie"].includes(k.toLowerCase()));
      url = next;
      continue;
    }
    const contentType = r.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
    const text = contentType ? TEXT_TYPE.test(contentType) : looksLikeText(r.body);
    const timings = redirects.length ? { ...r.timings, total: round(performance.now() - started) } : r.timings;
    return {
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
      body: text ? r.body.toString("utf8") : r.body.toString("base64"),
      bodyEncoding: text ? "utf8" : "base64",
      size: r.body.length,
      truncated: r.truncated,
      timings,
      httpVersion: r.httpVersion,
      remoteAddress: r.remoteAddress,
      redirects: redirects.length ? redirects : undefined,
    };
  }
}
