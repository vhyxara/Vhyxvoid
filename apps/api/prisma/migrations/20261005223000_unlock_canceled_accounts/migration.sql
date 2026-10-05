-- Accounts whose paid subscription ended were set to CANCELED, which locked
-- the whole workspace. They now stay ACTIVE on the FREE plan (the plan
-- resolver ignores canceled subscriptions). Only billing ever wrote CANCELED,
-- so every such row is one of these. Accounts still owing on another
-- subscription keep PAST_DUE semantics via the webhook; none are CANCELED.
UPDATE "Account"
SET "status" = 'ACTIVE', "graceEndsAt" = NULL, "updatedAt" = NOW()
WHERE "status" = 'CANCELED' AND "deletedAt" IS NULL;
