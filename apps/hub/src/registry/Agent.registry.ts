// // ─────────────────────────────────────────────────────────────────────────────
// // apps/hub/src/registry/AgentRegistry.ts
// // Single authoritative two-level map. No other AGENTS map exists anywhere.
// // ─────────────────────────────────────────────────────────────────────────────

// // NOTE: uWebSockets.js WebSocket is not a standard WebSocket.
// // We use 'any' here so the registry doesn't import uWS directly.
// // The router passes the uWS WebSocket instance — it's duck-typed.

// export interface AgentSession {
//   agentId: string; // hub-assigned UUID for this connection lifetime
//   accountId: string; // from validated API key
//   keyId: string; // the API key used for this agent
//   label: string; // human tunnel name e.g. "payment-service"
//   ws: any; // uWebSockets.js WebSocket (typed as any for isolation)
//   connectedAt: Date;
//   lastSeenAt: Date;
//   missedPings: number;
//   agentVersion: string;
//   ip: string;
// }

// type AccountAgents = Map<string, AgentSession>; // label → session

// export class AgentRegistry {
//   // accountId → (label → AgentSession)
//   private readonly accounts = new Map<string, AccountAgents>();
//   // Reverse index: agentId → session (O(1) pong lookup)
//   private readonly byAgentId = new Map<string, AgentSession>();
//   // Reverse index: ws instance → session (O(1) close handler lookup)
//   private readonly byWs = new Map<any, AgentSession>();

//   register(session: AgentSession): void {
//     let acct = this.accounts.get(session.accountId);
//     if (!acct) {
//       acct = new Map();
//       this.accounts.set(session.accountId, acct);
//     }

//     // If label already registered — evict the old connection first
//     const existing = acct.get(session.label);
//     if (existing) {
//       this.byAgentId.delete(existing.agentId);
//       this.byWs.delete(existing.ws);
//       try {
//         existing.ws.close();
//       } catch {}
//     }

//     acct.set(session.label, session);
//     this.byAgentId.set(session.agentId, session);
//     this.byWs.set(session.ws, session);
//   }

//   evict(accountId: string, label: string): AgentSession | null {
//     const acct = this.accounts.get(accountId);
//     if (!acct) return null;

//     const session = acct.get(label);
//     if (!session) return null;

//     acct.delete(label);
//     this.byAgentId.delete(session.agentId);
//     this.byWs.delete(session.ws);

//     if (acct.size === 0) this.accounts.delete(accountId);
//     return session;
//   }

//   find(accountId: string, label?: string): AgentSession | null {
//     const acct = this.accounts.get(accountId);
//     if (!acct || acct.size === 0) return null;
//     if (label) return acct.get(label) ?? null;
//     // No label → return first agent (single-agent accounts)
//     return acct.values().next().value ?? null;
//   }

//   findByAgentId(agentId: string): AgentSession | null {
//     return this.byAgentId.get(agentId) ?? null;
//   }

//   findByWs(ws: any): AgentSession | null {
//     return this.byWs.get(ws) ?? null;
//   }

//   findAllByAccount(accountId: string): AgentSession[] {
//     return Array.from(this.accounts.get(accountId)?.values() ?? []);
//   }

//   countByAccount(accountId: string): number {
//     return this.accounts.get(accountId)?.size ?? 0;
//   }

//   allSessions(): AgentSession[] {
//     const result: AgentSession[] = [];
//     for (const acct of this.accounts.values()) {
//       for (const s of acct.values()) result.push(s);
//     }
//     return result;
//   }

//   totalCount(): number {
//     let n = 0;
//     for (const acct of this.accounts.values()) n += acct.size;
//     return n;
//   }

//   evictAll(): void {
//     for (const s of this.byAgentId.values()) {
//       try {
//         s.ws.close();
//       } catch {}
//     }
//     this.accounts.clear();
//     this.byAgentId.clear();
//     this.byWs.clear();
//   }
// }

// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/registry/AgentRegistry.ts
// ─────────────────────────────────────────────────────────────────────────────

import { debugLog } from '@/utils/debug';

export interface AgentSession {
  agentId: string;
  accountId: string;
  keyId: string;
  label: string;
  ws: any; // uWebSockets.js WebSocket — typed as any for isolation
  connectedAt: Date;
  lastSeenAt: Date;
  missedPings: number;
  agentVersion: string;
  ip: string;
  /**
   * Fingerprint of the stored secret hash this connection authenticated
   * against (secretFingerprint() in HubAuth.service). After a rotation, the
   * sweep keeps a connection whose secret is now the key's previous one only
   * until the grace window ends, whether it connected before the rotation or
   * reconnected with the old secret during it (audit H3). Absent: not checked.
   */
  secretFingerprint?: string;
}

type AccountAgents = Map<string, AgentSession>; // label → session

export class AgentRegistry {
  private readonly accounts = new Map<string, AccountAgents>();
  private readonly byAgentId = new Map<string, AgentSession>();
  private readonly byWs = new Map<any, AgentSession>();

  register(session: AgentSession): void {
    debugLog('[AgentRegistry] register', {
      agentId: session.agentId,
      accountId: session.accountId,
      label: session.label,
    });
    let acct = this.accounts.get(session.accountId);
    if (!acct) {
      acct = new Map();
      this.accounts.set(session.accountId, acct);
    }
    // Evict any existing session with the same label
    const existing = acct.get(session.label);
    if (existing) {
      this.byAgentId.delete(existing.agentId);
      this.byWs.delete(existing.ws);
      try {
        existing.ws.close();
      } catch {}
    }
    acct.set(session.label, session);
    this.byAgentId.set(session.agentId, session);
    this.byWs.set(session.ws, session);
  }

  evict(accountId: string, label: string): AgentSession | null {
    const acct = this.accounts.get(accountId);
    if (!acct) return null;
    const session = acct.get(label);
    if (!session) return null;
    acct.delete(label);
    this.byAgentId.delete(session.agentId);
    this.byWs.delete(session.ws);
    if (acct.size === 0) this.accounts.delete(accountId);
    return session;
  }

  find(accountId: string, label?: string): AgentSession | null {
    const acct = this.accounts.get(accountId);
    if (!acct || acct.size === 0) return null;
    if (label) return acct.get(label) ?? null;
    return acct.values().next().value ?? null;
  }

  findByAgentId(agentId: string): AgentSession | undefined {
    // O(1) via the byAgentId reverse index maintained by register()/evict().
    // Previously scanned getAllSessions() — see context.md risk #20.
    return this.byAgentId.get(agentId);
  }

  findByWs(ws: any): AgentSession | null {
    return this.byWs.get(ws) ?? null;
  }

  countByAccount(accountId: string): number {
    return this.accounts.get(accountId)?.size ?? 0;
  }

  allSessions(): AgentSession[] {
    const result: AgentSession[] = [];
    for (const acct of this.accounts.values()) for (const s of acct.values()) result.push(s);
    return result;
  }

  totalCount(): number {
    let n = 0;
    for (const acct of this.accounts.values()) n += acct.size;
    return n;
  }

  evictAll(): void {
    for (const s of this.byAgentId.values())
      try {
        s.ws.close();
      } catch {}
    this.accounts.clear();
    this.byAgentId.clear();
    this.byWs.clear();
  }
}
