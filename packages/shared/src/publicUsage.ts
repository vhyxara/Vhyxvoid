// packages/shared/src/publicUsage.ts
//
// The public tunnel-URL path (accountslug--label.vhyxvoid.com) has no API
// key at all — callers are webhook providers, browsers, and teammates
// hitting a shared URL, not an authenticated SDK client. Its usage still
// needs to land in the same usage:{accountId}:{apiKeyId}:{metric}:{bucket}
// Redis counter and the same UsageAggregate flush pipeline the keyed SDK
// path already uses (apps/hub's HubUsageService writes, apps/api's
// RedisApiKeyCacheService.drainUsageCounters/FlushUsageWorker read).
//
// This sentinel stands in for "apiKeyId" in that Redis key so the public
// path can reuse the existing pipeline unchanged, and is the one place
// drainUsageCounters() special-cases before writing to Postgres — where it
// maps back to apiKeyId: null, UsageAggregate's own documented "account-
// level rollup" shape (see decision.md, 2026-09-22, "S5 investigation and
// proposal", Part 2.1). Exported from here so the hub (writer) and the api
// (reader) can never drift apart on the literal value.
export const PUBLIC_USAGE_SENTINEL = "_public";
