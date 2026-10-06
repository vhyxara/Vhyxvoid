// Delivers alert notifications to a customer's webhook URL (Slack incoming
// webhooks, Discord, or any endpoint taking JSON).
//
// The URL is customer-controlled, so it must not become a way into the
// platform's network (SSRF): HTTPS only in production, no credentials or
// odd ports, and the address is checked at CONNECT time (lookup hook), so a
// DNS answer that changes between validation and connection cannot reach a
// private address. No redirects are followed; 5 s timeout; response ignored.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { BlockList, isIP } from "node:net";

const PRIVATE = new BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96]] as const) PRIVATE.addSubnet(addr, prefix, "ipv6");

const allowPrivate = () => process.env.NODE_ENV !== "production" && process.env.ALERT_WEBHOOK_ALLOW_PRIVATE === "1";

export function isPrivateAddress(ip: string): boolean {
  const v4mapped = ip.toLowerCase().startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : null;
  if (v4mapped) return PRIVATE.check(v4mapped, "ipv4");
  const type = isIP(ip);
  if (type === 4) return PRIVATE.check(ip, "ipv4");
  if (type === 6) return PRIVATE.check(ip, "ipv6");
  return true;
}

/** Validation for the dashboard; returns an error message or undefined. */
export function validateWebhookUrl(raw: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Not a valid URL";
  }
  const production = process.env.NODE_ENV === "production";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && !production)) return "Use an https:// URL";
  if (u.username || u.password) return "Leave credentials out of the URL";
  if (u.port && !["443", "8443"].includes(u.port) && production) return "Use the standard HTTPS port";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host) && !allowPrivate()) return "That address is not reachable from the internet";
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host) && !allowPrivate()) return "That address is not reachable from the internet";
  return undefined;
}

function guardedLookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "", 0);
    const list = (addresses as dns.LookupAddress[]).filter((a) => allowPrivate() || !isPrivateAddress(a.address));
    if (!list.length) return cb(Object.assign(new Error("Webhook host resolves to a private address"), { code: "EPRIVATE" }), "", 0);
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

export async function postAlertWebhook(url: string, payload: unknown): Promise<string> {
  const err = validateWebhookUrl(url);
  if (err) return `error: ${err}`;
  const u = new URL(url);
  const body = Buffer.from(JSON.stringify(payload));
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = mod.request(
      u,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": body.length, "user-agent": "VhyxVoid-Alerts/1" },
        timeout: 5_000,
        lookup: guardedLookup as never,
      },
      (res) => {
        res.resume();
        const code = res.statusCode ?? 0;
        resolve(code >= 200 && code < 300 ? "ok" : `error: answered ${code}`);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (e) => resolve(`error: ${e.message}`));
    req.end(body);
  });
}
