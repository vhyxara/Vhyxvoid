// ─────────────────────────────────────────────────────────────────────────────
// SECURITY EVENT ENTITY
// Append-only. Written fire-and-forget from the gateway.
// Never blocks a request. Never updated after creation.
// ─────────────────────────────────────────────────────────────────────────────

import { SecurityEventType } from "@/core/constant/apikey.constant";
import { SecurityEvent } from "@/modules/key-management/domain/entities/security.entities";

export interface SecurityEventProps {
  id: string;
  apiKeyId: string | null;
  accountId: string | null;
  type: SecurityEventType;
  ip: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY EVENT REPOSITORY
// ─────────────────────────────────────────────────────────────────────────────

export interface SecurityEventRepository {
  /** Fire-and-forget insert — never throws, logs failures internally. */
  createSilent(event: SecurityEvent): Promise<void>;

  findByApiKey(apiKeyId: string, limit?: number): Promise<SecurityEvent[]>;

  findByAccount(accountId: string, limit?: number): Promise<SecurityEvent[]>;
}

export interface SecurityEventRepository {
  /** Fire-and-forget insert — never throws, logs failures internally. */
  createSilent(event: SecurityEvent): Promise<void>;

  findByApiKey(apiKeyId: string, limit?: number): Promise<SecurityEvent[]>;

  findByAccount(accountId: string, limit?: number): Promise<SecurityEvent[]>;
}
