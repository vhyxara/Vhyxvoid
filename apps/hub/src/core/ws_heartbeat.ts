export interface AgentSession {
  ws: WebSocket;
  missed: number;
  lastSeen: number;
}

export const AGENTS: Map<string, AgentSession> = new Map();

const HEARTBEAT_INTERVAL = 10000; // 10s
const HEARTBEAT_TIMEOUTS = 3; // miss 3 -> offline

// call this once after server starts
export function startHeartbeatLoop() {
  setInterval(() => {
    const now = Date.now();
    for (const [agentId, a] of AGENTS) {
      try {
        a.ws.send(JSON.stringify({ type: "ping", ts: now }));
        // set a promise / timestamp/state for expected pong
        if (!a.missed) a.missed = 0;
      } catch {
        a.missed = (a.missed || 0) + 1;
      }
    }
    // check missed counts
    for (const [agentId, a] of AGENTS) {
      if ((a.missed || 0) >= HEARTBEAT_TIMEOUTS) {
        console.log(
          `[hub] marking agent ${agentId} offline (missed ${a.missed})`
        );
        AGENTS.delete(agentId);
        // emit event to watchers if dashboard subscribes
      }
    }
  }, HEARTBEAT_INTERVAL);
}

export function runHeartbeatCheck() {
  const now = Date.now();
  for (const [agentId, a] of AGENTS) {
    try {
      a.ws.send(JSON.stringify({ type: "ping", ts: now }));
      if (!a.missed) a.missed = 0;
    } catch {
      a.missed = (a.missed || 0) + 1;
    }
  }
  for (const [agentId, a] of AGENTS) {
    if ((a.missed || 0) >= HEARTBEAT_TIMEOUTS) {
      AGENTS.delete(agentId);
    }
  }
}

export function handlePong(agentId: string) {
  if (!AGENTS.has(agentId)) return;
  const a = AGENTS.get(agentId)!;
  a.missed = 0;
  a.lastSeen = Date.now();
}

// handle incoming pong in handleMessage()
// case 'pong': {
//   const agentId = msg.agentId;
//   if (agentId && AGENTS.has(agentId)) {
//     AGENTS.get(agentId)!.missed = 0;
//     AGENTS.get(agentId)!.lastSeen = Date.now();
//   }
//   return;
// }
