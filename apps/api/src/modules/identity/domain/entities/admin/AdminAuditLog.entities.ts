// identity/domain/entities/AdminAuditLog.ts

export interface AdminAuditLogProps {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  changes: { before: any; after: any } | null;
  metadata: Record<string, any> | null;
  createdAt: Date;
}

/**
 * IMMUTABLE audit log entity
 * This is append-only - never updated or deleted
 * Preserves complete audit trail for compliance
 */
export class AdminAuditLog {
  private constructor(private props: AdminAuditLogProps) {}

  // Factory: Create new audit log entry
  static create(params: {
    adminId: string;
    action: string; // e.g., "user.created", "role.assigned"
    targetType: string; // e.g., "User", "AdminRole"
    targetId?: string;
    changes?: { before: any; after: any };
    metadata?: {
      ipAddress?: string;
      userAgent?: string;
      statusCode?: number;
      reason?: string;
    };
  }): AdminAuditLog {
    return new AdminAuditLog({
      id: crypto.randomUUID(),
      adminId: params.adminId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      changes: params.changes ?? null,
      metadata: params.metadata ?? null,
      createdAt: new Date(),
    });
  }

  // Rehydrate from database
  static rehydrate(props: AdminAuditLogProps): AdminAuditLog {
    return new AdminAuditLog(props);
  }

  // ============ Getters (Read-only) ============
  get id(): string {
    return this.props.id;
  }

  get adminId(): string {
    return this.props.adminId;
  }

  get action(): string {
    return this.props.action;
  }

  get targetType(): string {
    return this.props.targetType;
  }

  get targetId(): string | null {
    return this.props.targetId;
  }

  get changes(): Record<string, any> | null {
    return this.props.changes;
  }

  get metadata(): Record<string, any> | null {
    return this.props.metadata;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  // ============ Business Logic ============

  /**
   * Get human-readable description of the action
   */
  getActionDescription(): string {
    const actionMap: Record<string, string> = {
      // Admin User actions
      'admin.created': 'Admin user created',
      'admin.updated': 'Admin user profile updated',
      'admin.deleted': 'Admin user deleted',
      'admin.enabled': 'Admin user enabled',
      'admin.disabled': 'Admin user disabled',
      'admin.login': 'Admin user logged in',
      'admin.logout': 'Admin user logged out',
      'admin.password_changed': 'Admin password changed',
      'admin.token_refreshed': 'Admin access token refreshed',

      // Role actions
      'role.created': 'Role created',
      'role.updated': 'Role updated',
      'role.deleted': 'Role deleted',
      'role.assigned': 'Role assigned to admin',
      'role.revoked': 'Role revoked from admin',
      'role.activated': 'Role activated',
      'role.deactivated': 'Role deactivated',

      // Ability actions
      'ability.created': 'Ability created',
      'ability.updated': 'Ability updated',
      'ability.deleted': 'Ability deleted',
      'ability.assigned': 'Ability assigned to role',
      'ability.revoked': 'Ability revoked from role',

      // User actions
      'user.created': 'User created',
      'user.updated': 'User updated',
      'user.deleted': 'User deleted',
      'user.verified': 'User email verified',
      'user.locked': 'User account locked',
      'user.unlocked': 'User account unlocked',

      // Feedback
      'feedback.updated': 'Feedback triaged',

      // Settings
      'settings.updated': 'System settings updated',
    };

    return actionMap[this.props.action] || this.props.action;
  }

  /**
   * Get what was changed
   */
  getChanges(): { before: any; after: any } | null {
    return this.props.changes;
  }

  /**
   * Get request metadata
   */
  getMetadata(): {
    ipAddress?: string;
    userAgent?: string;
    statusCode?: number;
    reason?: string;
  } | null {
    return this.props.metadata as any;
  }

  /**
   * IMMUTABLE - cannot modify audit logs
   */
  toString(): string {
    return `[${this.props.createdAt.toISOString()}] Admin ${this.props.adminId} performed "${this.props.action}" on ${this.props.targetType}${
      this.props.targetId ? ` (${this.props.targetId})` : ''
    }`;
  }

  /**
   * Persist to database (read-only)
   */
  toPersistence(): AdminAuditLogProps {
    return { ...this.props };
  }
}

/**
 * Predefined audit actions
 */
export enum AuditAction {
  // Admin User
  ADMIN_CREATED = 'admin.created',
  ADMIN_UPDATED = 'admin.updated',
  ADMIN_DELETED = 'admin.deleted',
  ADMIN_ENABLED = 'admin.enabled',
  ADMIN_DISABLED = 'admin.disabled',
  ADMIN_LOGIN = 'admin.login',
  ADMIN_LOGOUT = 'admin.logout',
  ADMIN_PASSWORD_CHANGED = 'admin.password_changed',
  ADMIN_TOKEN_REFRESHED = 'admin.token_refreshed',

  // Role
  ROLE_CREATED = 'role.created',
  ROLE_UPDATED = 'role.updated',
  ROLE_DELETED = 'role.deleted',
  ROLE_ASSIGNED = 'role.assigned',
  ROLE_REVOKED = 'role.revoked',
  ROLE_ACTIVATED = 'role.activated',
  ROLE_DEACTIVATED = 'role.deactivated',

  // Ability
  ABILITY_CREATED = 'ability.created',
  ABILITY_UPDATED = 'ability.updated',
  ABILITY_DELETED = 'ability.deleted',
  ABILITY_ASSIGNED = 'ability.assigned',
  ABILITY_REVOKED = 'ability.revoked',

  // User
  USER_CREATED = 'user.created',
  USER_UPDATED = 'user.updated',
  USER_DELETED = 'user.deleted',
  USER_VERIFIED = 'user.verified',
  USER_LOCKED = 'user.locked',
  USER_UNLOCKED = 'user.unlocked',

  // Feedback
  FEEDBACK_UPDATED = 'feedback.updated',

  // Settings
  SETTINGS_UPDATED = 'settings.updated',
}
