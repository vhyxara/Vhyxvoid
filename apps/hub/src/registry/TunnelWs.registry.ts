// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/registry/TunnelWs.registry.ts
// One entry per live browser <-> tunnel WebSocket. Owns the answer to "which
// agent does this connection belong to", which the hub previously never
// recorded — it kept only connectionId -> browser socket, so it could neither
// reject a tunnel:ws:* frame from the wrong agent nor close a dropped agent's
// sockets. See internal-tools/shared/ws-tunnel-design.md (§3.1, D5, D10).
//
// Deliberately NOT PendingRegistry: that is a request/response registry with a
// timeout and a Redis mirror; a tunnel WebSocket has no response and lives for
// as long as the browser tab does. Deliberately in-memory only: nothing about a
// live socket is recoverable by another process, so there is nothing to mirror.
// ─────────────────────────────────────────────────────────────────────────────

import type { WebSocket } from 'ws';
import { toSendableCloseCode } from '@vhyxvoid/protocol';

export interface TunnelWsEntry {
  /** `ws_<uuid>` — hub-generated; the only correlation key on the wire. */
  connectionId: string;
  accountId: string;
  /** The agent that owns this tunnel. tunnel:ws:* from any other agent is ignored. */
  agentId: string;
  browserWs: WebSocket;
  openedAt: number;
}

// RFC 6455: a close reason plus the 2-byte code must fit a 125-byte control frame.
const MAX_CLOSE_REASON_BYTES = 123;

/**
 * Closes a browser socket without ever leaving it open. The code is translated
 * to one that may be sent (`ws` throws for 1005/1006/1015 — see closeCode.ts);
 * if closing still throws, the socket is terminated. Never throws.
 */
export function closeBrowserSocket(ws: WebSocket, code: number, reason: string): void {
  let safeReason = reason ?? '';
  while (Buffer.byteLength(safeReason) > MAX_CLOSE_REASON_BYTES) {
    safeReason = safeReason.slice(0, -1);
  }
  try {
    ws.close(toSendableCloseCode(code), safeReason);
  } catch {
    try {
      ws.terminate();
    } catch {
      // already gone
    }
  }
}

export class TunnelWsRegistry {
  private readonly byConnection = new Map<string, TunnelWsEntry>();
  /** agentId -> connectionIds, so a dropped agent's sockets are found in O(its own sockets). */
  private readonly byAgentId = new Map<string, Set<string>>();

  add(entry: TunnelWsEntry): void {
    this.byConnection.set(entry.connectionId, entry);
    let set = this.byAgentId.get(entry.agentId);
    if (!set) {
      set = new Set();
      this.byAgentId.set(entry.agentId, set);
    }
    set.add(entry.connectionId);
  }

  get(connectionId: string): TunnelWsEntry | undefined {
    return this.byConnection.get(connectionId);
  }

  /** Removes and returns the entry; undefined if it was already removed (idempotent teardown). */
  delete(connectionId: string): TunnelWsEntry | undefined {
    const entry = this.byConnection.get(connectionId);
    if (!entry) return undefined;
    this.byConnection.delete(connectionId);
    const set = this.byAgentId.get(entry.agentId);
    if (set) {
      set.delete(connectionId);
      if (set.size === 0) this.byAgentId.delete(entry.agentId);
    }
    return entry;
  }

  countByAgent(agentId: string): number {
    return this.byAgentId.get(agentId)?.size ?? 0;
  }

  size(): number {
    return this.byConnection.size;
  }

  /**
   * Removes every entry owned by the agent and closes each browser socket.
   * Returns how many were closed.
   */
  closeAllForAgent(agentId: string, code: number, reason: string): number {
    const ids = this.byAgentId.get(agentId);
    if (!ids) return 0;
    let closed = 0;
    for (const id of [...ids]) {
      const entry = this.delete(id);
      if (!entry) continue;
      closeBrowserSocket(entry.browserWs, code, reason);
      closed++;
    }
    return closed;
  }
}
