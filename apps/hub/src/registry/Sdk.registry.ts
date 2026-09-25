// // ─────────────────────────────────────────────────────────────────────────────
// // apps/hub/src/registry/SdkRegistry.ts
// // ─────────────────────────────────────────────────────────────────────────────

// export interface SdkSession {
//   sessionId: string;
//   accountId: string;
//   keyId: string;
//   ws: any; // uWebSockets.js WebSocket
//   connectedAt: Date;
// }

// export class SdkRegistry {
//   private readonly sessions = new Map<string, SdkSession>(); // sessionId → session
//   private readonly byWs = new Map<any, SdkSession>();

//   register(session: SdkSession): void {
//     this.sessions.set(session.sessionId, session);
//     this.byWs.set(session.ws, session);
//   }

//   evict(sessionId: string): SdkSession | null {
//     const s = this.sessions.get(sessionId);
//     if (!s) return null;
//     this.sessions.delete(sessionId);
//     this.byWs.delete(s.ws);
//     return s;
//   }

//   evictByWs(ws: any): SdkSession | null {
//     const s = this.byWs.get(ws);
//     if (!s) return null;
//     this.sessions.delete(s.sessionId);
//     this.byWs.delete(ws);
//     return s;
//   }

//   findByWs(ws: any): SdkSession | null {
//     return this.byWs.get(ws) ?? null;
//   }

//   totalCount(): number {
//     return this.sessions.size;
//   }
// }

// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/registry/SdkRegistry.ts
// ─────────────────────────────────────────────────────────────────────────────

export interface SdkSession {
  sessionId: string;
  accountId: string;
  keyId: string;
  ws: any;
  connectedAt: Date;
  /** Raw secret + matched hash from a raw-secret handshake (memory only). */
  credential?: { rawSecret: string; secretHash: string };
}

export class SdkRegistry {
  private readonly sessions = new Map<string, SdkSession>();
  private readonly byWs = new Map<any, SdkSession>();

  register(session: SdkSession): void {
    this.sessions.set(session.sessionId, session);
    this.byWs.set(session.ws, session);
  }

  evictByWs(ws: any): SdkSession | null {
    const s = this.byWs.get(ws);
    if (!s) return null;
    this.sessions.delete(s.sessionId);
    this.byWs.delete(ws);
    return s;
  }

  findByWs(ws: any): SdkSession | null {
    return this.byWs.get(ws) ?? null;
  }

  totalCount(): number {
    return this.sessions.size;
  }
}
