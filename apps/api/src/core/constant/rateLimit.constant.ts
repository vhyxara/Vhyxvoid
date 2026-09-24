// Client-IP trust and rate limits. See api/decision.md, 2026-09-24, "H1".
//
// Production chain: client -> Cloudflare -> nginx -> api:9000. nginx
// resolves the visitor from CF-Connecting-IP (real_ip, cloudflare-ips.conf)
// and appends that to X-Forwarded-For, so the rightmost entry is the only
// one nginx vouches for; everything left of it is client-supplied.
//
// Trust only private-network peers: nginx on the compose bridge network
// (172.18.0.0/16 today, but compose does not pin the subnet, so a literal
// CIDR could silently stop matching after a network recreate) and the
// host's loopback port publish, which arrives via the bridge gateway. A peer
// on a public address is never trusted, so its X-Forwarded-For is ignored
// and request.ip is the socket address. Fastify (proxy-addr) then takes the
// rightmost untrusted X-Forwarded-For entry as request.ip, i.e. the visitor.
export const TRUST_PROXY = ["loopback", "uniquelocal"];

// Every route, keyed on request.ip.
export const GLOBAL_RATE_LIMIT = { max: 100, timeWindow: "1 minute" };

// Tighter per-IP limits on the unauthenticated auth endpoints: credential
// guessing (login), email sending (forgot-password, resend-verification)
// and account creation (register).
export const AUTH_RATE_LIMITS = {
  login: { max: 10, timeWindow: "1 minute" },
  adminLogin: { max: 5, timeWindow: "1 minute" },
  register: { max: 10, timeWindow: "1 hour" },
  forgotPassword: { max: 5, timeWindow: "15 minutes" },
  resendVerification: { max: 5, timeWindow: "15 minutes" },
} as const;
