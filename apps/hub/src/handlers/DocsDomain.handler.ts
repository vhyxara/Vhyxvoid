// apps/hub/src/handlers/DocsDomain.handler.ts
//
// A customer's verified docs domain (docs.acme.dev -> their published API
// docs) is answered by the web app, not a tunnel. The edge (Caddy) sends
// every custom hostname to the hub, so the hub forwards these to DOCS_WEB_URL
// with x-vhyxvoid-docs-host; the web app's middleware turns that into the
// docs page for the host. Nothing else of the web app is reachable this way:
// the middleware only serves docs routes and static assets for such requests.

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';

export const DOCS_HOST_HEADER = 'x-vhyxvoid-docs-host';

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);

export function proxyDocsDomain(req: IncomingMessage, res: ServerResponse, webUrl: string, host: string): void {
  const target = new URL(webUrl);
  const mod = target.protocol === 'https:' ? https : http;
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || HOP.has(k) || k === DOCS_HOST_HEADER || k === 'cookie') continue;
    headers[k] = v;
  }
  headers[DOCS_HOST_HEADER] = host;
  headers['x-forwarded-host'] = host;
  headers['x-forwarded-proto'] = 'https';
  headers.host = target.host;
  const upstream = mod.request(
    { host: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), method: req.method, path: req.url ?? '/', headers, timeout: 30_000 },
    (up) => {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(up.headers)) if (v !== undefined && !HOP.has(k) && k !== 'set-cookie') out[k] = v;
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The docs are unavailable right now.');
    } else res.destroy();
  });
  req.pipe(upstream);
}
