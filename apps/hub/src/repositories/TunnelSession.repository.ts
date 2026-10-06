// apps/hub/src/repositories/TunnelSessionRepository.ts
//
// FIX: Removed the broken double-lookup pattern.
// The MessageRouter already resolves the internal apiKey UUID before calling upsert().
// This repo receives the internal UUID directly — no secondary lookup needed.

import type { MockApiDefinition, TrafficRule, TunnelPolicyRecord } from '@vhyxvoid/shared';
import { PrismaClient } from '@/generated/prisma';
import { randomUUID } from 'crypto';
import {
  currentPlanOverrides,
  getEffectivePlanLimitsForAccount,
  type Plan,
  type PlanLimits,
} from '@vhyxvoid/shared';

export type TunnelSessionStatus = 'CONNECTED' | 'DISCONNECTED' | 'EVICTED';

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

  async markDisconnected(agentId: string, status: 'DISCONNECTED' | 'EVICTED'): Promise<void> {
    await this.prisma.tunnelSession.updateMany({
      where: { agentId, status: 'CONNECTED' },
      data: { status, disconnectedAt: new Date() },
    });
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
      where: { accountId, status: 'CONNECTED' },
      select: { agentId: true, label: true, connectedAt: true, metadata: true },
      orderBy: { connectedAt: 'desc' },
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
      orderBy: { connectedAt: 'desc' },
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
    return this.prisma.tunnelSession.findUnique({
      where: { agentId },
      select: { id: true, accountId: true, label: true, status: true },
    }) as any;
  }
  // In TunnelSessionRepository (hub side)
  async findAccountSlug(accountId: string): Promise<string | null> {
    const row = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { slug: true },
    });
    return row?.slug ?? null;
  }
  /**
   * The account's real plan and its concurrent-agent limit, by the same rule
   * API-key creation uses (resolvePlanForAccount in @vhyxvoid/shared).
   */
  /** Access rules of one tunnel (apps/hub TunnelPolicyCache). */
  async findTunnelPolicy(accountId: string, label: string): Promise<TunnelPolicyRecord | null> {
    return (this.prisma as any).tunnelPolicy.findUnique({
      where: { accountId_label: { accountId, label } },
      select: { accountId: true, label: true, passwordHash: true, ipAllowlist: true, version: true },
    });
  }

  async findPlanLimitsForAccount(accountId: string): Promise<PlanLimits & { plan: Plan }> {
    // Built-in plan limits with the admin's plan-wide and per-account
    // overrides applied (settings `plans.overrides`, Account.limitOverrides).
    return getEffectivePlanLimitsForAccount(this.prisma as any, accountId, await currentPlanOverrides());
  }

  /** A tunnel's traffic rules, in order; null when it has none. */
  async findTrafficRules(accountId: string, label: string): Promise<TrafficRule[] | null> {
    const row = await (this.prisma as any).tunnelRuleSet.findUnique({ where: { accountId_label: { accountId, label } }, select: { rules: true } });
    return Array.isArray(row?.rules) ? (row.rules as TrafficRule[]) : null;
  }

  /** A label's hosted mock API (enabled ones only), or null. */
  async findMockApi(accountId: string, label: string): Promise<MockApiDefinition | null> {
    const row = await (this.prisma as any).mockApi.findUnique({
      where: { accountId_label: { accountId, label } },
      select: { enabled: true, mode: true, cors: true, latencyMs: true, endpoints: true },
    });
    if (!row || !row.enabled) return null;
    return { mode: row.mode, cors: row.cors, latencyMs: row.latencyMs, endpoints: Array.isArray(row.endpoints) ? row.endpoints : [] };
  }

  /** Account of a slug, for tunnel URLs with no agent registered; deleted accounts have none. */
  async findAccountIdBySlug(slug: string): Promise<string | null> {
    const row = await this.prisma.account.findUnique({ where: { slug }, select: { id: true, status: true } });
    return row && row.status !== 'DELETED' ? row.id : null;
  }

  /** Whether the workspace lets the request inspector store its requests. */
  async findInspectorCapture(accountId: string): Promise<boolean> {
    const row = await this.prisma.account.findUnique({ where: { id: accountId }, select: { inspectorCapture: true } });
    return row?.inspectorCapture ?? true;
  }

  /**
   * Real current status for a set of accounts, in one query — used by the
   * eviction sweep (Sweep.service.ts) to check every connected account's
   * live status without one query per session. Missing accountIds simply
   * aren't in the returned map; the caller decides what that means.
   */
  async findStatusesByAccountIds(
    accountIds: string[],
  ): Promise<Map<string, string>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, status: true },
    });
    return new Map(rows.map((r) => [r.id, r.status]));
  }

  /**
   * Current state of each connected agent's API key (by ApiKey.id), batched:
   * one query per AccountStatusSweep tick, like findStatusesByAccountIds.
   * A key id missing from the result no longer exists.
   */
  async findKeyStatesByIds(keyIds: string[]): Promise<
    Map<
      string,
      {
        status: string;
        expiresAt: Date | null;
        rotationGraceEndsAt: Date | null;
        secretHash: string;
        previousSecretHash: string | null;
      }
    >
  > {
    if (keyIds.length === 0) return new Map();
    const rows = await this.prisma.apiKey.findMany({
      where: { id: { in: keyIds } },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        rotationGraceEndsAt: true,
        secretHash: true,
        previousSecretHash: true,
      },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          status: r.status,
          expiresAt: r.expiresAt,
          rotationGraceEndsAt: r.rotationGraceEndsAt,
          secretHash: r.secretHash,
          previousSecretHash: r.previousSecretHash,
        },
      ]),
    );
  }

  async evictStaleForInstance(hubInstanceId: string): Promise<void> {
    await this.prisma.tunnelSession.updateMany({
      where: { hubInstanceId, status: 'CONNECTED' },
      data: { status: 'EVICTED', disconnectedAt: new Date() },
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
