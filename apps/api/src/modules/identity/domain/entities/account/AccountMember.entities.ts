import { RoleLevel } from "@/core/constant/account.constant";
import { Role } from "@/modules/identity/domain/entities/account/Role.entities";

// ============================================================
// ACCOUNT MEMBERSHIP ENTITY
//
// Composite PK: (userId + accountId) — no synthetic id column.
// Stores BOTH roleId (FK → Role) and roleLevel (Int, denormalized).
//
// Why denormalize roleLevel?
//   Fast numeric comparisons (actor.roleLevel >= RoleLevel.ADMIN)
//   without a join to the Role table on every permission check.
//   roleId gives the full named-role context when needed.
// ============================================================

export interface AccountMembershipProps {
  userId: string;
  accountId: string;
  roleId: string; // FK → Role
  roleLevel: number; // denormalized from Role.level — numeric for fast comparisons
  createdAt: Date;
}

export class AccountMembership {
  private constructor(private props: AccountMembershipProps) {}

  // ── Factories ──────────────────────────────────────────────

  /**
   * Create owner membership using a seeded system Role.
   * ownerRole must be the Role entity with level === RoleLevel.OWNER.
   */
  static createOwner(
    accountId: string,
    userId: string,
    ownerRole: Role,
  ): AccountMembership {
    return new AccountMembership({
      userId,
      accountId,
      roleId: ownerRole.id,
      roleLevel: ownerRole.level,
      createdAt: new Date(),
    });
  }

  static rehydrate(props: AccountMembershipProps): AccountMembership {
    return new AccountMembership(props);
  }

  /**
   * Generic factory — used when accepting an invitation or assigning a role.
   */
  static create(params: {
    accountId: string;
    userId: string;
    role: Role;
  }): AccountMembership {
    return new AccountMembership({
      userId: params.userId,
      accountId: params.accountId,
      roleId: params.role.id,
      roleLevel: params.role.level,
      createdAt: new Date(),
    });
  }

  // ── Getters ────────────────────────────────────────────────

  get userId(): string {
    return this.props.userId;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get roleId(): string {
    return this.props.roleId;
  }

  /**
   * Numeric role level — use this for permission comparisons.
   * e.g. membership.roleLevel >= RoleLevel.ADMIN
   */
  get roleLevel(): number {
    return this.props.roleLevel;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isOwner(): boolean {
    return this.props.roleLevel === RoleLevel.OWNER;
  }
  isAdmin(): boolean {
    return this.props.roleLevel >= RoleLevel.ADMIN;
  }
  isMember(): boolean {
    return this.props.roleLevel >= RoleLevel.MEMBER;
  }

  // ── Business Logic ─────────────────────────────────────────

  /**
   * Update both roleId and roleLevel atomically.
   * Always call this together — never update one without the other.
   */
  changeRole(newRole: Role): void {
    this.props.roleId = newRole.id;
    this.props.roleLevel = newRole.level;
  }

  canManage(target: AccountMembership): boolean {
    // Can only manage members with strictly lower role level
    return this.props.roleLevel > target.roleLevel;
  }

  canPromoteTo(targetLevel: number): boolean {
    // Cannot promote someone to a level equal to or higher than your own
    return targetLevel < this.props.roleLevel;
  }

  // ── Persistence ────────────────────────────────────────────

  toPersistence(): AccountMembershipProps {
    return { ...this.props };
  }
}
