import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { verifySignature } from './auth';
import { handlePong } from './ws_heartbeat';

type AgentConn = {
  agentId: string;
  backendKey?: string;
  ws: WebSocket;
  lastSeen: number;
};
type FrontendConn = {
  frontendId: string;
  apiKey?: string;
  ws: WebSocket;
  lastSeen: number;
};
type Pending = {
  resolve: (r: any) => void;
  reject: (e: any) => void;
  timeout: NodeJS.Timeout;
};
const AGENTS = new Map<string, AgentConn>();
const FRONTENDS = new Map<string, FrontendConn>();

const PENDING = new Map<string, Pending>();

export function createWebSocketServer(server: http.Server, opts?: { path?: string }) {
  const path = opts?.path ?? '/ws';
  const wss = new WebSocketServer({ server, path });
  console.log(`[hub] WS ready at ${path}`);

  wss.on('connection', (ws: WebSocket) => {
    const connId = uuidv4();
    console.log(`[hub] ws connection ${connId}`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, msg);
      } catch (e) {
        console.warn('[hub] invalid ws message', e);
        ws.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
      }
    });

    ws.on('close', () => {
      // cleanup maps
      for (const [k, v] of AGENTS)
        if (v.ws === ws) {
          AGENTS.delete(k);
          console.log('[hub] agent disconnected', k);
        }
      for (const [k, v] of FRONTENDS)
        if (v.ws === ws) {
          FRONTENDS.delete(k);
          console.log('[hub] frontend disconnected', k);
        }
    });

    ws.on('error', (e) => console.error('[hub] ws error', e));
  });
}

function handleBatch(ws: WebSocket, msg: any) {
  if (!msg.messages || !Array.isArray(msg.messages)) {
    return ws.send(JSON.stringify({ type: 'error', error: 'invalid_batch_format' }));
  }

  for (const item of msg.messages) {
    try {
      // IMPORTANT: Reuse existing routing logic
      handleMessage(ws, item);
    } catch (e) {
      console.error('[hub] error processing batch item', e);
    }
  }
}

function handleMessage(ws: WebSocket, msg: any) {
  if (!msg || !msg.type) return ws.send(JSON.stringify({ type: 'error', error: 'missing_type' }));
  // if (msg.type === "pong") {
  //   handlePong(msg.agentId);
  //   return;
  // }
  switch (msg.type) {
    case 'register': {
      const agentId = msg.agentId || uuidv4();
      AGENTS.set(agentId, {
        agentId,
        backendKey: msg.backendKey,
        ws,
        lastSeen: Date.now(),
      });
      ws.send(JSON.stringify({ type: 'registered', agentId }));
      console.log('[hub] agent registered', agentId);
      return;
    }

    case 'ping': {
      // Response is a normal pong
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now(), agentId: msg.agentId }));
      return;
    }
    case 'register_agent': {
      const agentId = msg.agentId || uuidv4();
      AGENTS.set(agentId, {
        agentId,
        backendKey: msg.backendKey,
        ws,
        lastSeen: Date.now(),
      });
      ws.send(JSON.stringify({ type: 'registered', agentId }));
      console.log('[hub] agent registered', agentId);
      return;
    }
    case 'batch': {
      return handleBatch(ws, msg);
    }

    case 'register_frontend':
    case 'register_front': {
      const frontendId = msg.frontendId || uuidv4();
      FRONTENDS.set(frontendId, {
        frontendId,
        apiKey: msg.apiKey,
        ws,
        lastSeen: Date.now(),
      });
      ws.send(JSON.stringify({ type: 'frontend_registered', frontendId }));
      console.log('[hub] frontend registered', frontendId);
      return;
    }

    case 'request': {
      return handleFrontendRequest(ws, msg);
    }

    case 'response': {
      return handleAgentResponse(msg);
    }

    case 'heartbeat': {
      if (msg.agentId && AGENTS.has(msg.agentId)) AGENTS.get(msg.agentId)!.lastSeen = Date.now();
      if (msg.frontendId && FRONTENDS.has(msg.frontendId))
        FRONTENDS.get(msg.frontendId)!.lastSeen = Date.now();
      return;
    }

    case 'pong': {
      handlePong(msg.agentId);
      return;
    }

    default:
      return ws.send(JSON.stringify({ type: 'error', error: 'unknown_type' }));
  }
}

function handleFrontendRequest(ws: WebSocket, msg: any) {
  const targetAgentId = msg.agentId || (AGENTS.size === 1 ? Array.from(AGENTS.keys())[0] : null);
  const requestId = msg.requestId || uuidv4();
  msg.requestId = requestId;

  // Signature metadata expected in msg.meta or msg.signature fields:
  // msg.meta = { frontendKey, signature, ts }
  const meta = msg.meta || {};
  const frontendKey = meta.frontendKey || msg.frontendKey || null;
  const signature = meta.signature || msg.signature || null;
  const ts = meta.ts || msg.ts || null;

  if (!frontendKey || !signature || !ts) {
    ws.send(JSON.stringify({ type: 'error', error: 'missing_signature', requestId }));
    return;
  }

  const ok = verifySignature({
    method: msg.method || 'GET',
    path: msg.path || '/',
    bodyBase64: msg.body || null,
    requestId,
    ts,
    signature,
    frontendKey,
  });

  if (!ok) {
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'invalid_signature',
        requestId,
        code: 403,
      }),
    );
    return;
  }

  if (!targetAgentId || !AGENTS.has(targetAgentId)) {
    ws.send(JSON.stringify({ type: 'error', error: 'agent_not_found', requestId }));
    return;
  }

  routeRequestToAgent(targetAgentId, msg)
    .then((agentResp) => {
      try {
        ws.send(JSON.stringify({ type: 'response', requestId, ...agentResp }));
      } catch (e) {
        console.error('[hub] failed send to frontend', e);
      }
    })
    .catch((err) => {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: err.message || 'agent_error',
            requestId,
          }),
        );
      } catch {}
    });
}

export function routeRequestToAgent(agentId: string | undefined, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!agentId) return reject(new Error('no_agent'));
    const agent = AGENTS.get(agentId);
    if (!agent) return reject(new Error('agent_offline'));

    const rid = payload.requestId || uuidv4();
    payload.requestId = rid;

    const timeout = setTimeout(() => {
      PENDING.delete(rid);
      reject(new Error('timeout'));
    }, 30000);

    PENDING.set(rid, { resolve, reject, timeout });

    try {
      agent.ws.send(JSON.stringify({ type: 'request', ...payload }));
    } catch (e) {
      clearTimeout(timeout);
      PENDING.delete(rid);
      reject(new Error('send_failed'));
    }
  });
}

function handleAgentResponse(msg: any) {
  const { requestId } = msg;
  if (!requestId) return console.warn('[hub] response missing requestId');

  const pending = PENDING.get(requestId);
  if (!pending) return console.warn('[hub] no pending request', requestId);

  clearTimeout(pending.timeout);
  PENDING.delete(requestId);
  pending.resolve({
    status: msg.status,
    headers: msg.headers || {},
    body: msg.body || null,
  });
}
