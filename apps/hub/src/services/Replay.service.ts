// apps/hub/src/services/Replay.service.ts
//
// "Replay" in the request inspector: send a captured request through the
// tunnel again. The hub sends it to itself over loopback with the tunnel's
// Host header, so it takes exactly the path real traffic takes (rate limit,
// agent lookup, streaming, capture); the internal secret marks it so the
// capture records `replayOf`.
//
// Not replayable: a request whose body was cut for the inspector (it could
// not be sent faithfully). Credentials (Authorization, Cookie, …) were never
// stored, so a replay goes without them.

import http from 'http';
import { inspectorKeys, parseInspectedRequests, replayableHeaders } from '@vhyxvoid/shared';

export interface ReplayParams {
  redis: { lrange(key: string, start: number, stop: number): Promise<unknown[]> };
  hubPort: number;
  hubDomain: string;
  secret: string;
  accountId: string;
  label: string;
  id: string;
  timeoutMs?: number;
}

export interface ReplayResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

export async function replayInspectedRequest(p: ReplayParams): Promise<ReplayResult> {
  if (!p.accountId || !p.label || !/^req_[a-f0-9]{32}$/.test(p.id)) {
    return { httpStatus: 400, body: { error: 'accountId, label and id are required' } };
  }
  const raw = await p.redis.lrange(inspectorKeys.list(p.accountId, p.label), 0, -1);
  const entry = parseInspectedRequests(raw).find((e) => e.id === p.id);
  if (!entry) return { httpStatus: 404, body: { error: 'That request is no longer in the inspector' } };
  if (entry.request.body.truncated) {
    return { httpStatus: 422, body: { error: 'The request body was larger than the inspector keeps, so it cannot be replayed exactly' } };
  }

  const body = entry.request.body.data
    ? Buffer.from(entry.request.body.data, entry.request.body.encoding === 'base64' ? 'base64' : 'utf8')
    : null;
  const headers: Record<string, string | number> = {
    ...replayableHeaders(entry.request.headers),
    host: `${entry.accountSlug}--${entry.label}.${p.hubDomain}`,
    'x-vhyxvoid-internal': p.secret,
    'x-vhyxvoid-replay-of': entry.id,
  };
  if (body) headers['content-length'] = body.length;

  const started = Date.now();
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: p.hubPort, method: entry.method, path: entry.path, headers, timeout: p.timeoutMs ?? 60_000 },
      (res) => {
        res.resume(); // the dashboard reads the result from the new capture
        res.on('end', () => resolve(res.statusCode ?? 0));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Replay timed out')));
    req.on('error', reject);
    req.end(body ?? undefined);
  });

  return { httpStatus: 200, body: { replayed: entry.id, status, durationMs: Date.now() - started } };
}
