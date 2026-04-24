import { ApiKeyRepository } from "@/core/types/api-key.types/apiKeyRepository";
import { ApiKeyCacheService } from "@/core/types/api-key.types/cacheService";

/**
 * Mark API keys as EXPIRED when expiresAt has passed.
 * Runs every 5 minutes.
 */
export class ExpireApiKeysWorker {
  constructor(
    private apiKeyRepository: ApiKeyRepository,
    private cacheService: ApiKeyCacheService,
  ) {}

  async run(): Promise<void> {
    const now = new Date();
    const keys = await this.apiKeyRepository.findExpiredKeys(now);

    for (const key of keys) {
      key.markExpired(now);
      await this.apiKeyRepository.save(key);
      await this.cacheService.invalidate(key.keyId);
    }
  }
}
