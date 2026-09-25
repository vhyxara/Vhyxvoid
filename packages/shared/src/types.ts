// packages/shared/src/types.ts
// All types the Hub imports from the identity module.
// Hub only imports from @vhyxvoid/shared — never from identity internals.
// NO Prisma imports here — Prisma lives in the app, not in shared packages.

// ── DB abstraction ────────────────────────────────────────────────────────────
// Instead of importing PrismaClient (which is app-specific),
// shared defines what data it needs from the DB. The caller provides
// an implementation using their own Prisma instance.
// This is the Dependency Inversion Principle applied to packages.

export interface ApiKeyRow {
  keyId: string;
  secretHash: string;
  previousSecretHash: string | null;
  rotationGraceEndsAt: Date | null;
  status: string;
  accountId: string;
  accountStatus: string;
  scopes: string[];
  expiresAt: Date | null;
  /**
   * Requests per minute allowed by the account's plan; -1 (or absent) means
   * unlimited. Supplied by the loader (buildDbApiKeyLoader reads the plan);
   * a loader that does not know the plan leaves it out and the key is treated
   * as unlimited, which is what every reload did before 2026-09-22.
   */
  rateLimitPerMinute?: number;
}

/**
 * The only DB operation shared/validateApiKey.ts needs.
 * Caller implements this using their own Prisma instance.
 *
 * In apps/api  → uses PrismaClient from '@/generated/prisma'
 * In apps/hub  → uses PrismaClient from '@/generated/prisma' (same DB, same generated client)
 */
export type DbApiKeyLoader = (keyId: string) => Promise<ApiKeyRow | null>;

// ── Validation result types ───────────────────────────────────────────────────

export interface GatewayValidationSuccess {
  valid: true;
  apiKeyId: string;
  accountId: string;
  scopes: string[];
  rateLimitPerMinute: number; // -1 means unlimited
}

export interface GatewayValidationFailure {
  valid: false;
  code: string;
  reason: string;
  // Populated whenever the key was successfully loaded before the failure
  // (i.e. every rejection from status checks onward, not timestamp/replay/
  // unknown-key rejections). Optional so callers that only need valid/code/
  // reason (e.g. the Hub) are unaffected; added so callers that want to
  // attribute a rejection to an account for audit logging (e.g. apps/api's
  // SecurityEvent trail) don't have to re-derive it themselves.
  accountId?: string;
}

export type GatewayValidationResult =
  | GatewayValidationSuccess
  | GatewayValidationFailure;

// ── Use case interface ─────────────────────────────────────────────────────────

export interface ValidateApiKeyParams {
  keyId: string;
  signature: string;
  method: string;
  path: string;
  query: string; // query string without "?", empty string if none; signed
  body: string; // raw body string, empty string if none
  requestId: string;
  timestamp: number; // unix ms
  requiredScope: string;
  ip: string;
  /**
   * Count this call as a usage request. Default true. The SDK connection
   * handshake (sdk:register) passes false: it opens a connection, it is not
   * a tunnelled request.
   */
  countUsage?: boolean;
}

export interface IValidateApiKeyUseCase {
  execute(params: ValidateApiKeyParams): Promise<GatewayValidationResult>;
}

// Alias — hub imports as ValidateApiKeyUseCase
export type ValidateApiKeyUseCase = IValidateApiKeyUseCase;
