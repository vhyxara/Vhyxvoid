// ─────────────────────────────────────────────────────────────────────────────
// API KEY REPOSITORY
// ─────────────────────────────────────────────────────────────────────────────

import {
  ApiKeyEnvironment,
  ApiKeyStatus,
} from "@/core/types/api-key.types/apiKeys";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { Prisma } from "@/generated/prisma";
import { ApiKey } from "@/modules/key-management/domain/entities/apiKey.entities";
import type {
  ApiKeyFilters,
  ApiKeyRepository,
} from "@/core/types/api-key.types/apiKeyRepository";

export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(key: ApiKey): Promise<void> {
    const p = key.toPersistence();

    await this.prisma.apiKey.upsert({
      where: { id: p.id },
      update: {
        name: p.name,
        description: p.description,
        secretHash: p.secretHash,
        previousSecretHash: p.previousSecretHash,
        rotationGraceEndsAt: p.rotationGraceEndsAt,
        status: p.status,
        expiresAt: p.expiresAt,
        lastUsedAt: p.lastUsedAt,
        revokedAt: p.revokedAt,
        revokedById: p.revokedById,
        updatedAt: p.updatedAt,
        // Scopes: delete existing + recreate
        scopes: {
          deleteMany: {},
          createMany: {
            data: p.scopes.map((scope) => ({
              scope,
              grantedAt: p.updatedAt,
            })),
          },
        },
      },
      create: {
        id: p.id,
        accountId: p.accountId,
        createdById: p.createdById,
        keyId: p.keyId,
        name: p.name,
        description: p.description,
        environment: p.environment,
        secretHash: p.secretHash,
        previousSecretHash: p.previousSecretHash,
        rotationGraceEndsAt: p.rotationGraceEndsAt,
        status: p.status,
        expiresAt: p.expiresAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        scopes: {
          createMany: {
            data: p.scopes.map((scope) => ({
              scope,
              grantedAt: p.createdAt,
            })),
          },
        },
      },
    });
  }

  async findById(id: string): Promise<ApiKey | null> {
    const data = await this.prisma.apiKey.findUnique({
      where: { id },
      include: { scopes: true },
    });
    return data ? this.toEntity(data) : null;
  }

  async findByKeyId(keyId: string): Promise<ApiKey | null> {
    const data = await this.prisma.apiKey.findUnique({
      where: { keyId },
      include: { scopes: true },
    });
    return data ? this.toEntity(data) : null;
  }

  async findAllByAccount(
    accountId: string,
    filters?: ApiKeyFilters,
  ): Promise<ApiKey[]> {
    const where: Prisma.ApiKeyWhereInput = { accountId };

    if (filters?.status) where.status = filters.status;
    if (filters?.environment) where.environment = filters.environment;
    if (filters?.createdById) where.createdById = filters.createdById;

    const data = await this.prisma.apiKey.findMany({
      where,
      include: { scopes: true },
      orderBy: { createdAt: "desc" },
    });
    return data.map((d) => this.toEntity(d));
  }

  async countActiveByAccount(accountId: string): Promise<number> {
    return this.prisma.apiKey.count({
      where: { accountId, status: ApiKeyStatus.ACTIVE },
    });
  }

  async revokeAllByAccount(
    accountId: string,
    revokedById: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.apiKey.updateMany({
      where: { accountId, status: ApiKeyStatus.ACTIVE },
      data: {
        status: ApiKeyStatus.REVOKED,
        revokedAt: now,
        revokedById,
        updatedAt: now,
      },
    });
  }

  async findExpiredKeys(now: Date): Promise<ApiKey[]> {
    const data = await this.prisma.apiKey.findMany({
      where: {
        status: ApiKeyStatus.ACTIVE,
        expiresAt: { lte: now },
      },
      include: { scopes: true },
    });
    return data.map((d) => this.toEntity(d));
  }

  async findExpiredRotations(now: Date): Promise<ApiKey[]> {
    const data = await this.prisma.apiKey.findMany({
      where: {
        rotationGraceEndsAt: { lte: now },
        previousSecretHash: { not: null },
      },
      include: { scopes: true },
    });
    return data.map((d) => this.toEntity(d));
  }

  // ── private mapper ─────────────────────────────────────────────────────────
  //
  // This is the only place raw Prisma data becomes a domain entity.
  // Every public method returns ApiKey (domain class), never the raw Prisma type.

  private toEntity(data: any): ApiKey {
    return ApiKey.rehydrate({
      id: data.id,
      accountId: data.accountId,
      createdById: data.createdById,
      keyId: data.keyId,
      name: data.name,
      description: data.description,
      environment: data.environment as ApiKeyEnvironment,
      secretHash: data.secretHash,
      previousSecretHash: data.previousSecretHash,
      rotationGraceEndsAt: data.rotationGraceEndsAt,
      scopes: (data.scopes ?? []).map((s: any) => s.scope),
      status: data.status as ApiKeyStatus,
      expiresAt: data.expiresAt,
      lastUsedAt: data.lastUsedAt,
      revokedAt: data.revokedAt,
      revokedById: data.revokedById,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }
}
