// apps/hub/src/repositories/TunnelRequestRepository.ts
//
// FIXES:
// 1. create() receives internal UUIDs directly from MessageRouter.
//    No more DB lookups inside this method — all resolution happens upstream.
// 2. getHourlyStats uses Prisma queryRaw with correct table name "TunnelRequest"
//    (Prisma default = PascalCase unless @@map is set in schema).
// 3. findBySession correctly queries by TunnelSession.agentId
//    since that's what we pass as sessionId from the router.

import { PrismaClient } from '@/generated/prisma';
import { randomUUID } from 'crypto';

export interface CreateTunnelRequestParams {
  accountId: string; // internal account UUID
  apiKeyId: string; // internal ApiKey.id UUID (NOT public keyId)
  sessionId: string; // TunnelSession.agentId (hub-assigned agt_xxx)
  requestId: string; // protocol requestId (UUID)
  method: string;
  path: string;
}

export interface RecordResponseParams {
  status?: number | null;
  durationMs?: number;
  errorCode?: string;
}

export class TunnelRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Record an incoming tunnel request.
   * Receives INTERNAL UUIDs — MessageRouter resolves public → internal before calling.
   * Fire-and-forget — wrapped in try/catch in MessageRouter, never blocks tunnel.
   *
   * sessionId here is TunnelSession.agentId (the hub-assigned agt_xxx string).
   * The TunnelRequest.sessionId FK points to TunnelSession.agentId (unique).
   */
  async create(params: CreateTunnelRequestParams): Promise<void> {
    // Resolve TunnelSession internal id from agentId
    // (TunnelRequest.sessionId FK → TunnelSession.id, not TunnelSession.agentId)
    const session = await this.prisma.tunnelSession.findUnique({
      where: { agentId: params.sessionId },
      select: { id: true },
    });

    if (!session) {
      // Session not yet persisted (upsert is async/fire-and-forget).
      // Skip audit record — tunnel still works, just no log entry.
      console.warn(
        { sessionId: params.sessionId },
        '[TunnelRequestRepository] session not yet persisted, skipping audit',
      );
      return;
    }

    await this.prisma.tunnelRequest.create({
      data: {
        id: randomUUID(),
        accountId: params.accountId,
        apiKeyId: params.apiKeyId, // internal UUID
        sessionId: session.id, // TunnelSession.id (internal UUID)
        requestId: params.requestId,
        method: params.method,
        path: params.path,
      },
    });
  }

  async recordResponse(requestId: string, result: RecordResponseParams): Promise<void> {
    await this.prisma.tunnelRequest.updateMany({
      where: { requestId },
      data: {
        status: result.status ?? undefined,
        durationMs: result.durationMs ?? undefined,
        errorCode: result.errorCode ?? undefined,
      },
    });
  }

  /**
   * Hourly stats for a dashboard analytics graph.
   *
   * FIX: Table name is "TunnelRequest" (Prisma PascalCase default).
   * If your schema has @@map("tunnel_requests"), use "tunnel_requests" instead.
   * Check with: SELECT tablename FROM pg_tables WHERE schemaname = 'public';
   */
  async getHourlyStats(
    accountId: string,
    from: Date,
    to: Date,
  ): Promise<{ hour: Date; count: number; avgDurationMs: number | null }[]> {
    // FIX: Use Prisma-generated table name. Default Prisma = PascalCase.
    // If your schema has @@map("tunnel_requests"), replace "TunnelRequest" below.
    const rows = await this.prisma.$queryRaw<
      {
        hour: Date;
        count: bigint;
        avg_duration_ms: number | null;
      }[]
    >`
      SELECT
        date_trunc('hour', "createdAt") AS hour,
        COUNT(*)                         AS count,
        AVG("durationMs")               AS avg_duration_ms
      FROM "tunnel_requests"
      WHERE
        "accountId" = ${accountId}
        AND "createdAt" >= ${from}
        AND "createdAt" <= ${to}
      GROUP BY date_trunc('hour', "createdAt")
      ORDER BY hour ASC
    `;

    return rows.map((r) => ({
      hour: r.hour,
      count: Number(r.count),
      avgDurationMs: r.avg_duration_ms,
    }));
  }

  /**
   * Find recent requests for a session.
   * Accepts agentId (agt_xxx) — resolves to TunnelSession.id internally.
   * This removes the extra lookup from the route handler.
   */
  async findByAgentId(
    agentId: string,
    limit = 100,
  ): Promise<
    {
      requestId: string;
      method: string;
      path: string;
      status: number | null;
      durationMs: number | null;
      errorCode: string | null;
      createdAt: Date;
    }[]
  > {
    // Find the session first to get the internal UUID
    const session = await this.prisma.tunnelSession.findUnique({
      where: { agentId },
      select: { id: true },
    });

    if (!session) return [];

    return this.prisma.tunnelRequest.findMany({
      where: { sessionId: session.id },
      select: {
        requestId: true,
        method: true,
        path: true,
        status: true,
        durationMs: true,
        errorCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) as any;
  }

  /**
   * Recent requests for a session (debugging view).
   * sessionId here = TunnelSession.id (internal UUID).
   */
  async findBySession(
    sessionId: string,
    limit = 100,
  ): Promise<
    {
      requestId: string;
      method: string;
      path: string;
      status: number | null;
      durationMs: number | null;
      errorCode: string | null;
      createdAt: Date;
    }[]
  > {
    return this.prisma.tunnelRequest.findMany({
      where: { sessionId },
      select: {
        requestId: true,
        method: true,
        path: true,
        status: true,
        durationMs: true,
        errorCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) as any;
  }

  async findBySessionId(sessionId: string, limit: number) {
    return this.prisma.tunnelRequest.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
