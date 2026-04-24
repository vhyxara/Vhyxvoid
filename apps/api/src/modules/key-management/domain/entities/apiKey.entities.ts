// src/modules/identity/domain/entities/apiKey/ApiKey.ts

import crypto from "crypto";
import { ForbiddenError } from "@/core/errors/error.format";
import { ApiKeyProps } from "@/core/types/api-key/apiKeys.type";
import {
  ApiKeyEnvironment,
  ApiKeyStatus,
  ApiScope,
} from "@/core/constant/apikey.constant";
import { KEY_PREFIX, ROTATION_GRACE_MS } from "@/core/constant/apikey.constant";

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATE ROOT
// ─────────────────────────────────────────────────────────────────────────────

export class ApiKey {
  private constructor(private props: ApiKeyProps) {}

  // ── Factories ──────────────────────────────────────────────────────────────

  /**
   * Create a brand new API key.
   *
   * Returns both the entity (to persist) and the rawSecret (to show the user).
   * The rawSecret is a random 32-byte hex string — shown exactly once,
   * never stored. Only its HMAC hash is persisted.
   */
  static create(params: {
    accountId: string;
    createdById: string;
    name: string;
    description?: string;
    environment: ApiKeyEnvironment;
    scopes: string[];
    expiresAt?: Date;
    pepper: string; // SERVER_HMAC_PEPPER from env vars
  }): { key: ApiKey; rawSecret: string } {
    const now = new Date();
    const rawKeyId =
      KEY_PREFIX[params.environment] + crypto.randomBytes(16).toString("hex");
    const rawSecret = crypto.randomBytes(32).toString("hex");
    const secretHash = ApiKey.hashSecret(rawSecret, params.pepper);

    const key = new ApiKey({
      id: crypto.randomUUID(),
      accountId: params.accountId,
      createdById: params.createdById,
      keyId: rawKeyId,
      name: params.name.trim(),
      description: params.description?.trim() ?? null,
      environment: params.environment,
      secretHash,
      previousSecretHash: null,
      rotationGraceEndsAt: null,
      scopes: params.scopes,
      status: ApiKeyStatus.ACTIVE,
      expiresAt: params.expiresAt ?? null,
      lastUsedAt: null,
      revokedAt: null,
      revokedById: null,
      createdAt: now,
      updatedAt: now,
    });

    return { key, rawSecret };
  }

  /**
   * Rehydrate from a database record.
   * Called by the Prisma repository after a DB read.
   */
  static rehydrate(props: ApiKeyProps): ApiKey {
    return new ApiKey(props);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get createdById(): string {
    return this.props.createdById;
  }
  get keyId(): string {
    return this.props.keyId;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string | null {
    return this.props.description;
  }
  get environment(): ApiKeyEnvironment {
    return this.props.environment;
  }
  get secretHash(): string {
    return this.props.secretHash;
  }
  get previousSecretHash(): string | null {
    return this.props.previousSecretHash;
  }
  get rotationGraceEndsAt(): Date | null {
    return this.props.rotationGraceEndsAt;
  }
  get scopes(): string[] {
    return [...this.props.scopes];
  }
  get status(): ApiKeyStatus {
    return this.props.status;
  }
  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }
  get lastUsedAt(): Date | null {
    return this.props.lastUsedAt;
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }
  get revokedById(): string | null {
    return this.props.revokedById;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ── State checks ───────────────────────────────────────────────────────────

  isActive(now: Date): boolean {
    return this.props.status === ApiKeyStatus.ACTIVE && !this.isExpired(now);
  }

  isRevoked(): boolean {
    return this.props.status === ApiKeyStatus.REVOKED;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt !== null && this.props.expiresAt <= now;
  }

  isInRotationGrace(now: Date): boolean {
    return (
      this.props.rotationGraceEndsAt !== null &&
      this.props.rotationGraceEndsAt > now
    );
  }

  hasScope(scope: string): boolean {
    return (
      this.props.scopes.includes(ApiScope.WILDCARD) ||
      this.props.scopes.includes(scope)
    );
  }

  isOwnedBy(userId: string): boolean {
    return this.props.createdById === userId;
  }

  // ── Business Logic ─────────────────────────────────────────────────────────

  /**
   * Rotate the key secret — zero-downtime rotation.
   *
   * The current secret becomes previousSecretHash.
   * Both secrets remain valid until rotationGraceEndsAt (1 hour).
   * After the grace window, only the new secret is accepted.
   *
   * Returns the new rawSecret — shown to the user exactly once.
   */
  rotate(pepper: string, now: Date): string {
    if (this.isRevoked()) {
      throw new ForbiddenError("Cannot rotate a revoked API key");
    }

    const rawSecret = crypto.randomBytes(32).toString("hex");
    const newHash = ApiKey.hashSecret(rawSecret, pepper);

    this.props.previousSecretHash = this.props.secretHash;
    this.props.secretHash = newHash;
    this.props.rotationGraceEndsAt = new Date(
      now.getTime() + ROTATION_GRACE_MS,
    );
    this.props.updatedAt = now;

    return rawSecret;
  }

  /**
   * Clear the rotation grace window after it expires.
   * Called by the ExpireRotationGraceWorker background job.
   */
  clearRotationGrace(now: Date): void {
    this.props.previousSecretHash = null;
    this.props.rotationGraceEndsAt = null;
    this.props.updatedAt = now;
  }

  /**
   * Revoke this key. Idempotent — safe to call multiple times.
   * Cache must be invalidated immediately after saving (done in use case).
   */
  revoke(revokedById: string, now: Date): void {
    if (this.isRevoked()) return;
    this.props.status = ApiKeyStatus.REVOKED;
    this.props.revokedAt = now;
    this.props.revokedById = revokedById;
    this.props.updatedAt = now;
  }

  markExpired(now: Date): void {
    this.props.status = ApiKeyStatus.EXPIRED;
    this.props.updatedAt = now;
  }

  update(params: { name?: string; description?: string }, now: Date): void {
    if (params.name?.trim()) this.props.name = params.name.trim();
    if (params.description !== undefined)
      this.props.description = params.description?.trim() ?? null;
    this.props.updatedAt = now;
  }

  updateScopes(scopes: string[], now: Date): void {
    this.props.scopes = scopes;
    this.props.updatedAt = now;
  }

  /** Record last used timestamp — called async, never blocks a request. */
  touchLastUsed(now: Date): void {
    this.props.lastUsedAt = now;
    this.props.updatedAt = now;
  }

  /**
   * Verify an HMAC-SHA256 signature from a client request.
   *
   * Accepts the current secret OR the previous secret (during rotation grace).
   * Uses timing-safe comparison to prevent timing attacks.
   *
   * canonical = METHOD|PATH|BODY_SHA256|REQUEST_ID|TIMESTAMP_MS
   */
  verifySignature(canonical: string, signature: string, now: Date): boolean {
    const verify = (hash: string): boolean => {
      try {
        const expected = crypto
          .createHmac("sha256", hash)
          .update(canonical)
          .digest("hex");

        return crypto.timingSafeEqual(
          Buffer.from(expected, "hex"),
          Buffer.from(signature, "hex"),
        );
      } catch {
        return false; // Buffer lengths differ → invalid
      }
    };

    if (verify(this.props.secretHash)) return true;

    // During rotation grace — also accept the previous secret
    if (
      this.props.previousSecretHash &&
      this.isInRotationGrace(now) &&
      verify(this.props.previousSecretHash)
    )
      return true;

    return false;
  }

  // ── Static Helpers ─────────────────────────────────────────────────────────

  /**
   * HMAC-SHA256 with a server-side pepper.
   * Pepper is stored in env vars — a DB breach alone cannot reverse the hash.
   */
  static hashSecret(rawSecret: string, pepper: string): string {
    return crypto.createHmac("sha256", pepper).update(rawSecret).digest("hex");
  }

  /**
   * Build the canonical request string for signature verification.
   * The client SDK must produce the identical string.
   *
   * Format: METHOD|PATH|BODY_SHA256|REQUEST_ID|TIMESTAMP_MS
   * Body is hashed with SHA-256. If body is empty, body hash is empty string.
   */
  static buildCanonical(params: {
    method: string;
    path: string;
    body: string; // raw request body or empty string
    requestId: string; // UUID — unique per request (replay protection)
    timestamp: number; // unix milliseconds
  }): string {
    const bodyHash = params.body
      ? crypto.createHash("sha256").update(params.body).digest("hex")
      : "";

    return [
      params.method.toUpperCase(),
      params.path,
      bodyHash,
      params.requestId,
      params.timestamp,
    ].join("|");
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /** Returns full props for DB persistence. Never pass this to API responses. */
  toPersistence(): ApiKeyProps {
    return { ...this.props, scopes: [...this.props.scopes] };
  }

  /**
   * Safe public DTO for API responses.
   * secretHash and previousSecretHash are intentionally omitted.
   */
  toPublicDTO() {
    return {
      id: this.props.id,
      keyId: this.props.keyId,
      name: this.props.name,
      description: this.props.description,
      environment: this.props.environment,
      scopes: [...this.props.scopes],
      status: this.props.status,
      expiresAt: this.props.expiresAt,
      lastUsedAt: this.props.lastUsedAt,
      createdAt: this.props.createdAt,
      updatedAt: this.props.updatedAt,
      // secretHash       ← intentionally omitted
      // previousSecretHash ← intentionally omitted
    };
  }
}
