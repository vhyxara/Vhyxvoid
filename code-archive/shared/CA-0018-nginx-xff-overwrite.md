# CA-0018: Tunnel nginx block appended to a client-supplied X-Forwarded-For (audit part2 G14)

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Security |
| Severity | Medium |
| Status | Fixed (in repo; needs deploy) |
| Source | internal-tools/shared/backlog.md (filed 2026-09-25 from audit part2) |
| Commit | `d61f681` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`$proxy_add_x_forwarded_for` let a caller prepend any IP, which a backend trusting the left-most entry would believe.

## Root cause

Tunnel hosts are DNS-only (no Cloudflare, no `real_ip` in that block), so the incoming header is fully attacker-controlled.

## Fix

The `*.vhyxvoid.com` block sets `X-Forwarded-For $remote_addr` (the TCP peer), with a comment naming which forwarded headers are trustworthy. The api/hub blocks (behind Cloudflare with `real_ip`) are unchanged.

## Files changed

- `nginx.conf`

## Tests

- None in the suite (config).

## Verification

`nginx -t` on the real config (stand-in certs/upstreams): OK. Live: nginx 1.24 in front of an echo server, request with `X-Forwarded-For: 6.6.6.6`: old config forwarded `6.6.6.6, 127.0.0.1`, new config `127.0.0.1`.

## Follow-ups / not done

Deploy: `git pull` then `docker compose up -d --force-recreate nginx` (see the H1/H5/H6 deploy note).
