# CA-0030: Pre-verification account takeover

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Security |
| Severity | Critical |
| Status | Fixed |
| Source | new finding, 2026-09-25 end-to-end run |
| Commit | `c415239` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

An attacker could register a victim's email address with their own password. Login worked before verification. When the victim later signed up, the existing unverified row kept the attacker's password and a new verification link went to the victim; clicking it verified an account the attacker could log into.

## Root cause

`LoginUseCase` never checked `isEmailVerified`; `RegisterUserUseCase` re-sent a verification link for an existing unverified user without touching the stored password.

## Fix

- Login refuses unverified accounts with 403 (after the password check, so it reveals nothing to someone without the password).
- Re-registering an unverified address cancels earlier verification and reset links and emails a "Finish creating your account" link (a password-reset token, 24 h) so the inbox owner chooses their own password; the response is identical to a first registration.
- `ResetPasswordUseCase` on an unverified user marks the address verified and creates the personal workspace (shared `ensurePersonalAccount` helper, also used by VerifyEmail).
- Also: development no longer mails a hardcoded personal Gmail address when `DEV_EMAIL` is unset; `ConsoleEmailService` prints emails outside production when no Resend key is set; used/expired tokens are 400 (were 500).

## Files changed

- `apps/api/src/modules/identity/application/use-cases/user/{Login,Register,ResetPassword,VerifyEmail}.usecase.ts`
- `apps/api/src/modules/identity/application/services/personalAccount.ts (new)`
- `apps/api/src/modules/notification/{application/use-cases/index.ts,infrastructure/email/templates/index.ts,infrastructure/email/ConsoleEmailService.ts,infrastructure/email/ResendEmailService.ts}`
- `apps/api/src/modules/identity/domain/entities/user/{EmailVerificationToken,PasswordResetToken}.entities.ts`

## Tests

- tests/e2e/preVerificationTakeover.test.ts (new, 4 tests)
- e2e step "security: registering someone else's address can't take it over"

## Verification

Unit tests plus the live scenario: attacker login before verification 403; after the victim finishes signup the attacker's password is 401 and the owner's works.

## Follow-ups / not done

Residual, industry-standard: a person who clicks a verification link for a signup they never started verifies an account with someone else's password. The email says to ignore it.
