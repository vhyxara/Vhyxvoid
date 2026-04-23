// identity/domain/entities/AdminSession.ts

import { UnauthorizedError } from '@/core/errors/error.format';

export interface AdminSessionProps {
  id: string;
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  ipAddress: string;
  userAgent: string;
}

export class AdminSession {
  private constructor(private props: AdminSessionProps) {}

  // Factory: Create new session
  static create(params: {
    adminId: string;
    tokenHash: string;
    ttlMs: number;
    ipAddress: string;
    userAgent: string;
  }): AdminSession {
    const now = new Date();

    return new AdminSession({
      id: crypto.randomUUID(),
      adminId: params.adminId,
      tokenHash: params.tokenHash,
      expiresAt: new Date(now.getTime() + params.ttlMs),
      revokedAt: null,
      createdAt: now,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
  }

  // Rehydrate from database
  static rehydrate(props: AdminSessionProps): AdminSession {
    return new AdminSession(props);
  }

  // ============ Getters ============
  get id(): string {
    return this.props.id;
  }

  get adminId(): string {
    return this.props.adminId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get ipAddress(): string {
    return this.props.ipAddress;
  }

  get userAgent(): string {
    return this.props.userAgent;
  }

  // ============ Business Logic ============

  /**
   * Check if session is revoked
   */
  isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  /**
   * Check if session is expired
   */
  isExpired(now: Date): boolean {
    return this.props.expiresAt <= now;
  }

  /**
   * Check if session is valid (not revoked and not expired)
   */
  isValid(now: Date): boolean {
    return !this.isRevoked() && !this.isExpired(now);
  }

  /**
   * Ensure session is active
   */
  ensureActive(now: Date): void {
    if (this.isRevoked()) {
      throw new UnauthorizedError('Session has been revoked');
    }

    if (this.isExpired(now)) {
      throw new UnauthorizedError('Session has expired');
    }
  }

  /**
   * Revoke session
   */
  revoke(now: Date): void {
    if (!this.props.revokedAt) {
      this.props.revokedAt = now;
    }
  }

  /**
   * Rotate session (create new with new token, revoke old)
   */
  rotate(newTokenHash: string, ttlMs: number, now: Date): AdminSession {
    this.revoke(now); // Revoke current session

    return AdminSession.create({
      adminId: this.props.adminId,
      tokenHash: newTokenHash,
      ttlMs,
      ipAddress: this.props.ipAddress,
      userAgent: this.props.userAgent,
    });
  }

  /**
   * Persist to database format
   */
  toPersistence(): AdminSessionProps {
    return { ...this.props };
  }
}
