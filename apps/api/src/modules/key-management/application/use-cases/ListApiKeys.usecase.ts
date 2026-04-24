// ─────────────────────────────────────────────────────────────────────────────
// LIST API KEYS
// ─────────────────────────────────────────────────────────────────────────────

import { API_KEY_PERMISSIONS } from "@/core/constant/apikey.constant";
import { ForbiddenError } from "@/core/errors/error.format";
import {
  ApiKeyStatus,
  ApiKeyEnvironment,
} from "@/core/types/api-key.types/apiKeys";
import { ApiKeyDeps } from "@/core/types/api-key.types/sharedApiKeys";
import { ApiKey } from "@/modules/key-management/domain/entities/apiKey.entities";

// export class ListApiKeysUseCase {
//   constructor(private deps: Pick<ApiKeyDeps, 'apiKeyRepository' | 'membershipRepository'>) {}

//   async execute(params: {
//     accountId: string;
//     actorUserId: string;
//     status?: ApiKeyStatus;
//     environment?: ApiKeyEnvironment;
//   }): Promise<ReturnType<ApiKey['toPublicDTO']>[]> {
//     const { membershipRepository, apiKeyRepository } = this.deps;

//     const membership = await membershipRepository.findByAccountAndUser(
//       params.accountId,
//       params.actorUserId,
//     );
//     if (!membership) throw new ForbiddenError('You are not a member of this account');

//     // MEMBER: can only see their own created keys
//     // ADMIN+: can see all keys in the account
//     const filters = {
//       status: params.status,
//       environment: params.environment,
//       createdById: API_KEY_PERMISSIONS.canListAll(membership.roleLevel)
//         ? undefined
//         : params.actorUserId,
//     };

//     const keys = await apiKeyRepository.findAllByAccount(params.accountId, filters);
//     return keys.map((k) => k.toPublicDTO());
//   }
// }

export interface ListApiKeysParams {
  accountId: string;
  actorUserId: string;
  status?: ApiKeyStatus;
  environment?: ApiKeyEnvironment;
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: "name" | "createdAt" | "lastUsedAt" | "status" | "environment";
  sortOrder?: "asc" | "desc";
}

export interface ListApiKeysResult {
  items: ReturnType<ApiKey["toPublicDTO"]>[];
  total: number;
  page: number;
  limit: number;
}

export class ListApiKeysUseCase {
  constructor(
    private deps: Pick<ApiKeyDeps, "apiKeyRepository" | "membershipRepository">,
  ) {}

  async execute(params: ListApiKeysParams): Promise<ListApiKeysResult> {
    const {
      accountId,
      actorUserId,
      status,
      environment,
      page = 1,
      limit = 20,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = params;

    const { membershipRepository, apiKeyRepository } = this.deps;

    // 1. Permission check
    const membership = await membershipRepository.findByAccountAndUser(
      accountId,
      actorUserId,
    );
    if (!membership)
      throw new ForbiddenError("You are not a member of this account");

    // 2. Fetch with filters
    const filters = {
      status,
      environment,
      createdById: API_KEY_PERMISSIONS.canListAll(membership.roleLevel)
        ? undefined
        : actorUserId,
    };

    const allKeys = await apiKeyRepository.findAllByAccount(accountId, filters);
    const dtos = allKeys.map((k) => k.toPublicDTO());

    // 3. Search across name, keyId, description
    const filtered = search
      ? dtos.filter((k) => {
          const q = search.toLowerCase();
          return (
            k.name.toLowerCase().includes(q) ||
            k.keyId.toLowerCase().includes(q) ||
            (k.description ?? "").toLowerCase().includes(q) ||
            k.environment.toLowerCase().includes(q) ||
            k.status.toLowerCase().includes(q)
          );
        })
      : dtos;

    // 4. Sort
    const sorted = [...filtered].sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      switch (sortBy) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "environment":
          return dir * a.environment.localeCompare(b.environment);
        case "lastUsedAt": {
          const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
          const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
          return dir * (aTime - bTime);
        }
        case "createdAt":
        default: {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return dir * (aTime - bTime);
        }
      }
    });

    // 5. Paginate
    const total = sorted.length;
    const offset = (page - 1) * limit;
    const items = sorted.slice(offset, offset + limit);

    return { items, total, page, limit };
  }
}
