import { ApiKeyRepository } from "@/core/types/api-key/apiKeys.type";
import { ApiKeyCacheService } from "@/core/types/api-key/cacheservice.type";

/**
 * Expire rotation grace windows after they end.
 * Runs every 10 minutes.
 */
export class ExpireRotationGraceWorker {
  constructor(
    private apiKeyRepository: ApiKeyRepository,
    private cacheService: ApiKeyCacheService,
  ) {}

  async run(): Promise<void> {
    const now = new Date();
    const keys = await this.apiKeyRepository.findExpiredRotations(now);

    for (const key of keys) {
      key.clearRotationGrace(now);
      await this.apiKeyRepository.save(key);
      await this.cacheService.invalidate(key.keyId);
    }
  }
}
