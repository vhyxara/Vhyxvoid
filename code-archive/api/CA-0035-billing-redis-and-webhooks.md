# CA-0035: Billing had no Redis; Stripe webhook 500s and duplicate processing

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Bug fix |
| Severity | High |
| Status | Fixed |
| Source | new finding, 2026-09-25 end-to-end run |
| Commit | `42f6652` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

(1) After a Stripe-driven plan or status change, cached API-key entries were never invalidated. (2) A badly signed webhook answered 500. (3) A re-delivered event was processed again. (4) Used invitations and several domain rules answered 500.

## Root cause

(1) `fastify.redis` was decorated inside `ApiKeyPlugins`' encapsulated Fastify context; `billingPlugin`, registered beside it, got `undefined`, and the invalidator failed soft on every call. (2) The signature error was untyped. (3) No event-id idempotency. (4) Domain entities threw plain `Error`.

## Fix

- `redisPlugin` registered once at the root, before every plugin that needs it.
- Signature failure → 400 `VALIDATION_ERROR`; missing header uses the standard envelope.
- `StripeEventLog`: event ids claimed in Redis (`SET NX`, 7 days); duplicates answer `{received:true, duplicate:true}`; a failed handler releases its id so Stripe's retry is processed. Fails open if Redis is down.
- Typed 400/403 errors in AccountInvitation, Role and Account entities.

## Files changed

- `apps/api/src/modules/identity/presentation/plugins/register.plugin.ts`
- `apps/api/src/modules/key-management/presentation/plugins/usecases/api-plugins.ts`
- `apps/api/src/modules/billing/{application/use-cases/webhook/HandleStripeWebhook.usecase.ts,presentation/plugins/billing.plugin.ts,presentation/http/webhook.routes.ts}`
- `apps/api/src/modules/identity/domain/entities/account/{AccountInvitation,Role,Account}.entities.ts`

## Tests

- tests/e2e/stripeWebhookDedupe.test.ts (new, 3 tests)
- e2e billing section: bad signature 400, upgrade to PRO, duplicate delivery processed once, invite/accept, past_due grace, cancel to FREE

## Verification

Live: `stripe:evt:*` keys appear and the second delivery reports duplicate (proves billing now sees Redis).

## Follow-ups / not done

`customer.subscription.trial_will_end` is still acknowledged but not emailed (api backlog, G11).
