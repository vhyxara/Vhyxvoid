// The server-side sender behind the dashboard's API client: requests go out
// from the platform, so there are no CORS problems, and they must never reach
// the platform's own network (SSRF). Same guard as alert webhooks
// (alerts/webhook.ts): the address is checked at connect time by the lookup
// hook, and literal private addresses and internal names are refused before
// that. Every redirect hop is checked again. API_CLIENT_ALLOW_PRIVATE=1 (never
// in production) lets local development reach 127.0.0.1.
import dns from "node:dns";
import { isIP } from "node:net";
import { sendHttp, type ApiResponse, type BuiltRequest, type LookupFn } from "@vhyxvoid/shared";
import { isPrivateAddress } from "../alerts/webhook";

export const allowPrivateTargets = () => process.env.NODE_ENV !== "production" && process.env.API_CLIENT_ALLOW_PRIVATE === "1";

const guardedLookup: LookupFn = (hostname, options, cb) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "", 0);
    const list = (addresses as dns.LookupAddress[]).filter((a) => allowPrivateTargets() || !isPrivateAddress(a.address));
    if (!list.length) return cb(Object.assign(new Error("private address"), { code: "EPRIVATE" }), "", 0);
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
};

/** Refusal message for a URL, or undefined. */
export function targetProblem(u: URL): string | undefined {
  if (allowPrivateTargets()) return undefined;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if ((isIP(host) && isPrivateAddress(host)) || /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) {
    return "That address is private; the API client sends to public addresses only. To test a local server, use `vhyxvoid test` on your machine or open a tunnel to it.";
  }
  return undefined;
}

export interface GuardedOptions {
  timeoutMs: number;
  maxBytes: number;
  followRedirects: number;
}

export function guardedSend(built: BuiltRequest, opts: GuardedOptions): Promise<ApiResponse> {
  return sendHttp(built, { ...opts, lookup: guardedLookup, checkUrl: targetProblem, userAgent: "VhyxVoid-API-Client/1 (+https://vhyxvoid.com)" });
}
