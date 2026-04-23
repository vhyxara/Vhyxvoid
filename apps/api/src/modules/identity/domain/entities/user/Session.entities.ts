// identity/domain/entities/Session.ts

import { UnauthorizedError } from "@/core/errors/error.format";

export interface SessionProps {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  ipAddress: string;
  userAgent: string;
}

export class Session {
  private constructor(private props: SessionProps) {}

  // ── Factories ──────────────────────────────────────────────

  static create(params: {
    userId: string;
    tokenHash: string;
    ttlMs: number;
    ipAddress: string;
    userAgent: string;
  }): Session {
    // Guard: ttlMs should be at least 1 minute and at most 1 year
    if (params.ttlMs < 60_000 || params.ttlMs > 365 * 24 * 60 * 60 * 1000) {
      throw new Error(
        `Invalid ttlMs: ${params.ttlMs}. Must be between 1 minute and 1 year in milliseconds.`,
      );
    }
    const now = new Date();
    return new Session({
      id: crypto.randomUUID(),
      userId: params.userId,
      tokenHash: params.tokenHash,
      expiresAt: new Date(now.getTime() + params.ttlMs),
      revokedAt: null,
      createdAt: now,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
  }

  static rehydrate(props: SessionProps): Session {
    return new Session(props);
  }

  // ── Getters ────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get tokenHash(): string {
    return this.props.tokenHash;
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get ipAddress(): string {
    return this.props.ipAddress;
  }
  get userAgent(): string {
    return this.props.userAgent;
  }

  // ── Business Logic ─────────────────────────────────────────

  isExpired(now: Date): boolean {
    return this.props.expiresAt <= now;
  }
  isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }
  isValid(now: Date): boolean {
    return !this.isRevoked() && !this.isExpired(now);
  }

  ensureActive(now: Date): void {
    if (this.isRevoked())
      throw new UnauthorizedError("Session has been revoked");
    if (this.isExpired(now)) throw new UnauthorizedError("Session has expired");
  }

  revoke(now: Date): void {
    if (!this.props.revokedAt) {
      this.props.revokedAt = now;
    }
  }

  toPersistence(): SessionProps {
    return { ...this.props };
  }

  /**
   * Token rotation: revoke current session and return a new one.
   * The old session record is saved as revoked; new one is inserted.
   */

  rotate(newTokenHash: string, ttlMs: number, now: Date): Session {
    this.revoke(now); // revoke current token
    return Session.create({
      userId: this.props.userId,
      tokenHash: newTokenHash,
      ttlMs,
      ipAddress: this.props.ipAddress,
      userAgent: this.props.userAgent,
    });
  }
}
