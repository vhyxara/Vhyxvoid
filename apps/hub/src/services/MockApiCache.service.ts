// apps/hub/src/services/MockApiCache.service.ts
//
// Hosted mock APIs per tunnel label (mock_apis rows), cached in-process like
// traffic rules: 30 s TTL, "no mock" cached too, dropped at once by the API's
// /internal/policies/invalidate call. A failed lookup means "no mock" (fail
// open, like traffic rules: mocks are a development tool, not a security
// boundary). `features.mockApis` off makes the hub ignore every mock.
//
// Each cached mock carries its own counters for "sequential" endpoints; they
// start over when the mock is saved (the cache entry is replaced).

import { readSetting, type MockApiDefinition } from '@vhyxvoid/shared';

const TTL_MS = 30_000;

export interface MockApiSource {
  findMockApi(accountId: string, label: string): Promise<MockApiDefinition | null>;
}

export interface CachedMock {
  def: MockApiDefinition;
  sequence: Map<string, number>;
}

export class MockApiCache {
  private readonly cache = new Map<string, { mock: CachedMock | null; expiresAt: number }>();

  constructor(
    private readonly source: MockApiSource,
    private readonly now: () => number = Date.now,
  ) {}

  private key(accountId: string, label: string) {
    return `${accountId}\u0000${label}`;
  }

  /** The label's enabled mock, or null (none, switched off, feature off, lookup failed). */
  async get(accountId: string, label: string): Promise<CachedMock | null> {
    if (!(await readSetting('features.mockApis'))) return null;
    const k = this.key(accountId, label);
    const hit = this.cache.get(k);
    if (hit && hit.expiresAt > this.now()) return hit.mock;
    try {
      const def = await this.source.findMockApi(accountId, label);
      const mock = def ? { def, sequence: new Map<string, number>() } : null;
      this.cache.set(k, { mock, expiresAt: this.now() + TTL_MS });
      if (this.cache.size > 50_000) this.cache.delete(this.cache.keys().next().value as string);
      return mock;
    } catch (err) {
      console.warn({ err: (err as Error).message, accountId, label }, '[mocks] lookup failed; answering without the mock');
      return null;
    }
  }

  invalidate(accountId: string, label?: string): void {
    if (label) {
      this.cache.delete(this.key(accountId, label));
      return;
    }
    for (const k of this.cache.keys()) if (k.startsWith(`${accountId}\u0000`)) this.cache.delete(k);
  }
}
