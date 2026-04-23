// identity/domain/entities/AdminRole.ts

import { ConflictError } from '@/core/errors/error.format';

export interface AdminRoleProps {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class AdminRole {
  private constructor(private props: AdminRoleProps) {}

  // Factory: Create new custom role
  static create(params: { name: string; description?: string }): AdminRole {
    const now = new Date();

    return new AdminRole({
      id: crypto.randomUUID(),
      name: params.name,
      description: params.description ?? null,
      isSystem: false, // ← custom role
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Factory: Create system role (only for initialization)
  static createSystem(params: { name: string; description?: string }): AdminRole {
    const now = new Date();

    return new AdminRole({
      id: crypto.randomUUID(),
      name: params.name,
      description: params.description ?? null,
      isSystem: true, // ← system role (protected)
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Rehydrate from database
  static rehydrate(props: AdminRoleProps): AdminRole {
    return new AdminRole(props);
  }

  // ============ Getters ============
  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get isSystem(): boolean {
    return this.props.isSystem;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  // ============ Business Logic ============

  /**
   * Validate that system roles cannot be modified
   */
  private validateNotSystem(): void {
    if (this.props.isSystem) {
      throw new ConflictError('System roles cannot be modified');
    }
  }

  /**
   * Update role details
   */
  update(params: { name?: string; description?: string }, now: Date): void {
    this.validateNotSystem();

    if (params.name && params.name.trim().length > 0) {
      this.props.name = params.name;
    }

    if (params.description !== undefined) {
      this.props.description = params.description || null;
    }

    this.props.updatedAt = now;
  }

  /**
   * Deactivate role (soft delete)
   */
  deactivate(now: Date): void {
    this.validateNotSystem();

    if (!this.props.isActive) {
      throw new ConflictError('Role is already deactivated');
    }

    this.props.isActive = false;
    this.props.updatedAt = now;
  }

  /**
   * Reactivate role
   */
  activate(now: Date): void {
    this.validateNotSystem();

    if (this.props.isActive) {
      throw new ConflictError('Role is already active');
    }

    this.props.isActive = true;
    this.props.updatedAt = now;
  }

  /**
   * Check if role can be deleted
   */
  canBeDeleted(): boolean {
    return !this.props.isSystem;
  }

  /**
   * Persist to database format
   */
  toPersistence(): AdminRoleProps {
    return { ...this.props };
  }
}
