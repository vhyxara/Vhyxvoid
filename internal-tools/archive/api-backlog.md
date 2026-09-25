# Backlog archive — api

Resolved items from `internal-tools/api/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: apps/api.**

## Archive

- [x] **Usage never reaches `UsageAggregate` on any path: the drain drops every counter (data loss, not deferred-cosmetic).** `RedisApiKeyCacheService.drainUsageCounters()` reads `results[i][1]`, which is ioredis's `[err, value]` tuple shape, but the client is `@upstash/redis` (1.36.1), whose `pipeline().exec()` returns plain deserialized values (`chunk-*.mjs` `exec`: `res.map(... => deserialize(result))`). `results[i]` is e.g. the number `2`, so `2[1]` is `undefined`, `if (!raw) continue` skips every counter, and then `redis.del(...keys)` deletes them all anyway. Affects SDK and public-path usage alike. Fix: `const raw = results?.[i]`, then handle number or string. `tests/e2e/publicPathUsageRollup.test.ts:27` hides it by mocking `exec` with ioredis tuples, so fix the mock to Upstash's shape too. Also note the flush only visits accounts with an ACTIVE key (`apiKeyPlugin.ts` flushInterval), so a keyless account's public-path usage is never drained even after this fix. Found 2026-09-24 by cross-verifying the S5 close-out report (its "bug #2"); production UsageAggregate row count not checked (prod DB read not permitted that session).
  Resolved 2026-09-24, a68f355 + 369f350 (+ 9840c8a, audit H4 core), drain reads Upstash's plain pipeline values, the flush visits every account with pending counters, and keyed counters are written under `ApiKey.id` instead of the public keyId. (Deleted from backlog.md by the fixing session under the old delete-on-fix rule; text restored here verbatim from a copy read earlier that day. Re-confirmed against the code 2026-09-24, session 2026-09-24-archive-crosscheck-c3c4.)
