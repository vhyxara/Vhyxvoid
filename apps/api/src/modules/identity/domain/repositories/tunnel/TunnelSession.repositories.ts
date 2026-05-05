// apps/api/src/modules/identity/domain/repositories/tunnel/TunnelSessionRepository.ts
//
// FIX: Removed the broken double-lookup pattern.
// The MessageRouter already resolves the internal apiKey UUID before calling upsert().
// This repo receives the internal UUID directly — no secondary lookup needed.

import { PrismaClient } from "@/generated/prisma";
import { randomUUID } from "crypto";

export type TunnelSessionStatus = "CONNECTED" | "DISCONNECTED" | "EVICTED";

export interface UpsertSessionParams {
  agentId: string; // hub-assigned e.g. agt_xxx
  accountId: string; // internal account UUID
  apiKeyId: string; // internal ApiKey.id UUID (NOT the public vhyxvoid_live_xxx)
  label: string;
  status: TunnelSessionStatus;
  hubInstanceId: string;
  metadata?: Record<string, unknown>;
}

export class TunnelSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert a tunnel session.
   * Receives the INTERNAL ApiKey UUID — never the public keyId string.
   * MessageRouter resolves public → internal before calling this.
   */
  async upsert(params: UpsertSessionParams): Promise<void> {
    await this.prisma.tunnelSession.upsert({
      where: { agentId: params.agentId },
      update: {
        status: params.status,
        hubInstanceId: params.hubInstanceId,
        connectedAt: new Date(),
        disconnectedAt: null,
        metadata: (params.metadata ?? {}) as any,
      },
      create: {
        id: randomUUID(),
        agentId: params.agentId,
        accountId: params.accountId,
        apiKeyId: params.apiKeyId, // internal UUID — FK will resolve
        label: params.label,
        status: params.status,
        hubInstanceId: params.hubInstanceId,
        metadata: (params.metadata ?? {}) as any,
      },
    });
  }

  async markDisconnected(
    agentId: string,
    status: "DISCONNECTED" | "EVICTED",
  ): Promise<void> {
    await this.prisma.tunnelSession.updateMany({
      where: { agentId, status: "CONNECTED" },
      data: { status, disconnectedAt: new Date() },
    });
  }
  async findConnectedByAccountAndLabel(
    accountId: string,
    label: string,
  ): Promise<{
    agentId: string;
    label: string;
    status: string;
    accountId: string;
  } | null> {
    const row = await this.prisma.tunnelSession.findFirst({
      where: {
        accountId,
        label,
        status: "CONNECTED",
      },
      select: {
        agentId: true,
        label: true,
        status: true,
        accountId: true,
      },
    });
    return row ?? null;
  }
  /**
   * Find active sessions for an account.
   * Returns agentId (hub-assigned), not the internal session UUID.
   */
  async findConnectedByAccount(accountId: string): Promise<
    {
      agentId: string;
      label: string;
      connectedAt: Date;
      metadata: Record<string, unknown> | null;
    }[]
  > {
    return this.prisma.tunnelSession.findMany({
      where: { accountId, status: "CONNECTED" },
      select: { agentId: true, label: true, connectedAt: true, metadata: true },
      orderBy: { connectedAt: "desc" },
    }) as any;
  }

  async findByAccount(
    accountId: string,
    limit = 50,
  ): Promise<
    {
      agentId: string;
      label: string;
      status: string;
      connectedAt: Date;
      disconnectedAt: Date | null;
    }[]
  > {
    return this.prisma.tunnelSession.findMany({
      where: { accountId },
      select: {
        agentId: true,
        label: true,
        status: true,
        connectedAt: true,
        disconnectedAt: true,
      },
      orderBy: { connectedAt: "desc" },
      take: limit,
    }) as any;
  }

  /**
   * Find a session by hub-assigned agentId (agt_xxx).
   * Returns { id, accountId } for ownership verification.
   * Added to fix the /tunnels/:agentId/requests route.
   */
  async findByAgentId(agentId: string): Promise<{
    id: string;
    accountId: string;
    label: string;
    status: string;
  } | null> {
    console.log("agent id", agentId);
    return this.prisma.tunnelSession.findUnique({
      where: { agentId },
      select: { id: true, accountId: true, label: true, status: true },
    }) as any;
  }

  async evictStaleForInstance(hubInstanceId: string): Promise<void> {
    await this.prisma.tunnelSession.updateMany({
      where: { hubInstanceId, status: "CONNECTED" },
      data: { status: "EVICTED", disconnectedAt: new Date() },
    });
  }

  /**
   * Resolve public keyId (vhyxvoid_live_xxx) → internal { id, accountId }.
   * Called ONCE in MessageRouter.handleAgentRegister().
   * Result is stored on AgentSession and reused — never called per-request.
   */
  async findApiKeyByPublicId(
    publicKeyId: string,
  ): Promise<{ id: string; accountId: string } | null> {
    return this.prisma.apiKey.findUnique({
      where: { keyId: publicKeyId },
      select: { id: true, accountId: true },
    });
  }
}
