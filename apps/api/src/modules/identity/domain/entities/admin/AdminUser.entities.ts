// identity/domain/entities/AdminUser.ts

import { UnauthorizedError } from '@/core/errors/error.format';

export interface AdminUserProps {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  status: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Signed into access tokens; bumped (in the database) to revoke them. */
  tokenVersion?: number;
}

export class AdminUser {
  private constructor(private props: AdminUserProps) {}

  // Factory: Create new admin
  static create(params: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
  }): AdminUser {
    const now = new Date();

    return new AdminUser({
      id: crypto.randomUUID(),
      email: params.email,
      passwordHash: params.passwordHash,
      firstName: params.firstName,
      lastName: params.lastName,
      isSuperAdmin: false, // ← default to regular admin
      status: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  // Factory: Create super admin (one-time during setup)
  static createSuperAdmin(params: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
  }): AdminUser {
    const now = new Date();

    return new AdminUser({
      id: crypto.randomUUID(),
      email: params.email,
      passwordHash: params.passwordHash,
      firstName: params.firstName,
      lastName: params.lastName,
      isSuperAdmin: true, // ← super admin flag
      status: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  // Rehydrate from database
  static rehydrate(props: AdminUserProps): AdminUser {
    return new AdminUser(props);
  }

  // ============ Getters ============
  get id(): string {
    return this.props.id;
  }

  get email(): string {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get firstName(): string {
    return this.props.firstName;
  }

  get lastName(): string {
    return this.props.lastName;
  }

  get fullName(): string {
    return `${this.props.firstName} ${this.props.lastName}`.trim();
  }

  get tokenVersion(): number {
    return this.props.tokenVersion ?? 0;
  }

  get isSuperAdmin(): boolean {
    return this.props.isSuperAdmin;
  }

  get status(): boolean {
    return this.props.status;
  }

  get lastLoginAt(): Date | null {
    return this.props.lastLoginAt;
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  // ============ Business Logic ============

  /**
   * Ensure admin is active and can perform actions
   */
  ensureCanLogin(now: Date): void {
    if (this.props.deletedAt) {
      throw new UnauthorizedError('Admin account has been deleted');
    }

    if (!this.props.status) {
      throw new UnauthorizedError('Admin account is disabled');
    }
  }

  /**
   * Record successful login
   */
  recordLogin(now: Date): void {
    this.props.lastLoginAt = now;
    this.props.updatedAt = now;
  }

  /**
   * Update profile (not email)
   */
  updateProfile(firstName: string, lastName: string, now: Date): void {
    if (firstName && firstName.trim().length > 0) {
      this.props.firstName = firstName;
    }
    if (lastName && lastName.trim().length > 0) {
      this.props.lastName = lastName;
    }
    this.props.updatedAt = now;
  }

  /**
   * Disable admin (soft deactivate)
   */
  disable(now: Date): void {
    if (this.props.isSuperAdmin) {
      throw new UnauthorizedError('Cannot disable super admin account');
    }
    this.props.status = false;
    this.props.updatedAt = now;
  }

  /**
   * Enable admin
   */
  enable(now: Date): void {
    this.props.status = true;
    this.props.updatedAt = now;
  }

  /**
   * Soft delete (preserve audit trail)
   */
  softDelete(now: Date): void {
    if (this.props.isSuperAdmin) {
      throw new UnauthorizedError('Cannot delete super admin account');
    }
    this.props.deletedAt = now;
    this.props.status = false;
    this.props.updatedAt = now;
  }

  /**
   * Restore deleted admin
   */
  restore(now: Date): void {
    this.props.deletedAt = null;
    this.props.status = true;
    this.props.updatedAt = now;
  }

  /**
   * Check if super admin (read-only, cannot be changed)
   */
  validateSuperAdminProtection(): void {
    if (this.props.isSuperAdmin) {
      throw new UnauthorizedError('Super admin account is protected and immutable');
    }
  }

  /**
   * Persist to database format
   */
  toPersistence(): AdminUserProps {
    return { ...this.props };
  }
}
