import {
  ApiKeyEnvironment,
  ApiKeyStatus,
} from "@/core/constant/apikey.constant";
import { MembershipRepository } from "@/modules/identity/domain/repositories/account/Account.repositories";
import { PlanLimitService } from "@/core/types/api-key/plans.type";
import { ApiKeyCacheService } from "@/core/types/api-key/cacheservice.type";
import { ApiKey } from "@/modules/key-management/domain/entities/apiKey.entities";

export { ApiKey };

export interface ApiKeyFilters {
  status?: ApiKeyStatus;
  environment?: ApiKeyEnvironment;
  createdById?: string; // filter to keys created by a specific user (MEMBER view)
}

export interface ApiKeyRepository {
  save(key: ApiKey): Promise<void>;

  findById(id: string): Promise<ApiKey | null>;
  findByKeyId(keyId: string): Promise<ApiKey | null>; // public keyId lookup — gateway path

  findAllByAccount(
    accountId: string,
    filters?: ApiKeyFilters,
  ): Promise<ApiKey[]>;

  countActiveByAccount(accountId: string): Promise<number>; // plan limit check

  // Bulk operations
  revokeAllByAccount(
    accountId: string,
    revokedById: string,
    now: Date,
  ): Promise<void>;
  findExpiredKeys(now: Date): Promise<ApiKey[]>; // for expiry worker
  findExpiredRotations(now: Date): Promise<ApiKey[]>; // for grace cleanup worker
}

export interface ApiKeyProps {
  id: string;
  accountId: string;
  createdById: string;

  /**
   * Public identifier — what clients embed in their applications.
   * Prefixed by environment: vhyxvoid_dev_... or vhyxvoid_live_...
   * Used for all gateway lookups. Never used as DB primary key.
   */
  keyId: string;

  name: string;
  description: string | null;
  environment: ApiKeyEnvironment;

  /**
   * Secret hashes — NEVER returned in API responses, NEVER logged.
   * secretHash          = HMAC-SHA256(rawSecret, SERVER_HMAC_PEPPER)
   * previousSecretHash  = the old hash kept during zero-downtime rotation
   * rotationGraceEndsAt = old secret valid until this timestamp
   */
  secretHash: string;
  previousSecretHash: string | null;
  rotationGraceEndsAt: Date | null;

  /** Flat array of ApiScope string values. Stored in ApiKeyScope join table. */
  scopes: string[];

  status: ApiKeyStatus;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedById: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyDeps {
  apiKeyRepository: ApiKeyRepository;
  membershipRepository: MembershipRepository;
  planLimitService: PlanLimitService;
  cacheService: ApiKeyCacheService;
  pepper: string; // SERVER_HMAC_PEPPER from env
}

export type ApiKeyPublicDTO = ReturnType<ApiKey["toPublicDTO"]>;
