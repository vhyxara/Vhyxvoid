// identity/domain/entities/AdminAbility.ts

import { ConflictError } from '@/core/errors/error.format';

export interface AdminAbilityProps {
  id: string;
  action: string;
  category: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Granular permission entity
 * Examples:
 * - user.create, user.read, user.update, user.delete
 * - role.create, role.read, role.update, role.delete
 * - settings.read, settings.update
 * - audit_logs.read
 */
export class AdminAbility {
  private constructor(private props: AdminAbilityProps) {}

  // Factory: Create new custom ability
  static create(params: {
    action: string; // e.g., "user.create"
    category: string; // e.g., "users"
    description?: string;
  }): AdminAbility {
    const now = new Date();

    return new AdminAbility({
      id: crypto.randomUUID(),
      action: params.action,
      category: params.category,
      description: params.description ?? null,
      isSystem: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Factory: Create system ability (only during initialization)
  static createSystem(params: {
    action: string;
    category: string;
    description?: string;
  }): AdminAbility {
    const now = new Date();

    return new AdminAbility({
      id: crypto.randomUUID(),
      action: params.action,
      category: params.category,
      description: params.description ?? null,
      isSystem: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Rehydrate from database
  static rehydrate(props: AdminAbilityProps): AdminAbility {
    return new AdminAbility(props);
  }

  // ============ Getters ============
  get id(): string {
    return this.props.id;
  }

  get action(): string {
    return this.props.action;
  }

  get category(): string {
    return this.props.category;
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

  // ============ Business Logic ============

  /**
   * Validate system abilities cannot be modified
   */
  private validateNotSystem(): void {
    if (this.props.isSystem) {
      throw new ConflictError('System abilities cannot be modified');
    }
  }

  /**
   * Update ability details
   */
  update(params: { description?: string }, now: Date): void {
    this.validateNotSystem();

    if (params.description !== undefined) {
      this.props.description = params.description || null;
    }

    this.props.updatedAt = now;
  }

  /**
   * Deactivate ability
   */
  deactivate(now: Date): void {
    this.validateNotSystem();

    if (!this.props.isActive) {
      throw new ConflictError('Ability is already deactivated');
    }

    this.props.isActive = false;
    this.props.updatedAt = now;
  }

  /**
   * Reactivate ability
   */
  activate(now: Date): void {
    this.validateNotSystem();

    if (this.props.isActive) {
      throw new ConflictError('Ability is already active');
    }

    this.props.isActive = true;
    this.props.updatedAt = now;
  }

  /**
   * Check if ability can be deleted
   */
  canBeDeleted(): boolean {
    return !this.props.isSystem;
  }

  /**
   * Persist to database format
   */
  toPersistence(): AdminAbilityProps {
    return { ...this.props };
  }
}

/**
 * Predefined system abilities for initialization
 * These are immutable and cannot be deleted
 */
export const SYSTEM_ABILITIES = {
  // User Management
  USER_CREATE: { action: 'user.create', category: 'users', description: 'Create new user' },
  USER_READ: { action: 'user.read', category: 'users', description: 'View user details' },
  USER_UPDATE: { action: 'user.update', category: 'users', description: 'Update user information' },
  USER_DELETE: { action: 'user.delete', category: 'users', description: 'Delete/deactivate user' },

  // Role Management
  ROLE_CREATE: { action: 'role.create', category: 'roles', description: 'Create new role' },
  ROLE_READ: { action: 'role.read', category: 'roles', description: 'View role details' },
  ROLE_UPDATE: { action: 'role.update', category: 'roles', description: 'Update role' },
  ROLE_DELETE: { action: 'role.delete', category: 'roles', description: 'Delete role' },
  ROLE_ASSIGN: { action: 'role.assign', category: 'roles', description: 'Assign roles to admins' },

  // Ability Management
  ABILITY_CREATE: {
    action: 'ability.create',
    category: 'abilities',
    description: 'Create new ability',
  },
  ABILITY_READ: {
    action: 'ability.read',
    category: 'abilities',
    description: 'View ability details',
  },
  ABILITY_UPDATE: {
    action: 'ability.update',
    category: 'abilities',
    description: 'Update ability',
  },
  ABILITY_DELETE: {
    action: 'ability.delete',
    category: 'abilities',
    description: 'Delete ability',
  },

  // Admin Management
  ADMIN_CREATE: {
    action: 'admin.create',
    category: 'admins',
    description: 'Create new admin user',
  },
  ADMIN_READ: { action: 'admin.read', category: 'admins', description: 'View admin details' },
  ADMIN_UPDATE: {
    action: 'admin.update',
    category: 'admins',
    description: 'Update admin information',
  },
  ADMIN_DELETE: {
    action: 'admin.delete',
    category: 'admins',
    description: 'Delete/deactivate admin',
  },
  ADMIN_ENABLE: { action: 'admin.enable', category: 'admins', description: 'Enable admin account' },
  ADMIN_DISABLE: {
    action: 'admin.disable',
    category: 'admins',
    description: 'Disable admin account',
  },

  // Audit Logs
  AUDIT_READ: { action: 'audit.read', category: 'audit_logs', description: 'View audit logs' },
  AUDIT_EXPORT: {
    action: 'audit.export',
    category: 'audit_logs',
    description: 'Export audit logs',
  },

  // Settings
  SETTINGS_READ: {
    action: 'settings.read',
    category: 'settings',
    description: 'View system settings',
  },
  SETTINGS_UPDATE: {
    action: 'settings.update',
    category: 'settings',
    description: 'Update system settings',
  },

  // Platform operations (admin panel v2). Note: the user.* abilities above
  // govern customer (end-user) accounts; admin.* governs admin users.
  SYSTEM_READ: { action: 'system.read', category: 'system', description: 'View dashboard, system health and plan limits' },
  ACCOUNT_READ: { action: 'account.read', category: 'accounts', description: 'View customer accounts' },
  ACCOUNT_UPDATE: { action: 'account.update', category: 'accounts', description: 'Suspend, restrict, reactivate accounts; edit limits and notes' },
  ACCOUNT_DELETE: { action: 'account.delete', category: 'accounts', description: 'Delete customer accounts' },
  APIKEY_READ: { action: 'apikey.read', category: 'api_keys', description: 'View API keys of every account' },
  APIKEY_REVOKE: { action: 'apikey.revoke', category: 'api_keys', description: 'Revoke any API key' },
  TUNNEL_READ: { action: 'tunnel.read', category: 'tunnels', description: 'View live tunnels and connection history' },
  TUNNEL_DISCONNECT: { action: 'tunnel.disconnect', category: 'tunnels', description: 'Force-disconnect a live agent' },
  BILLING_READ: { action: 'billing.read', category: 'billing', description: 'View subscriptions, invoices and revenue' },
  LOGS_READ: { action: 'logs.read', category: 'logs', description: 'View security events, user activity and request logs' },
  CONTENT_READ: { action: 'content.read', category: 'content', description: 'View website content' },
  CONTENT_UPDATE: { action: 'content.update', category: 'content', description: 'Create and edit website content drafts' },
  CONTENT_PUBLISH: { action: 'content.publish', category: 'content', description: 'Publish and unpublish website content' },
  CONTENT_DELETE: { action: 'content.delete', category: 'content', description: 'Delete website content' },
};
