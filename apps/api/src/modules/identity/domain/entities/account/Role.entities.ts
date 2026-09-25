// ============================================================
// ROLE ENTITY
// Per-account named roles. Three system roles are auto-seeded
// on account creation (OWNER, ADMIN, MEMBER) and cannot be deleted.
// Additional custom roles can be created per account.
// ============================================================

import { ForbiddenError, ValidationError } from "@/core/errors/error.format";
import { RoleLevel } from "@/core/constant/account.constant";

export interface RoleProps {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  level: number; // numeric — RoleLevel enum value (100, 70, 10, or custom)
  isSystem: boolean; // system roles cannot be deleted or renamed
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Role {
  private constructor(private props: RoleProps) {}

  // ── Factories ──────────────────────────────────────────────

  /**
   * Seed the three immutable system roles for a new account.
   * Call this inside the same transaction as Account creation.
   */
  static seedSystemRoles(accountId: string): [Role, Role, Role] {
    const now = new Date();

    const make = (name: string, level: number, description: string): Role =>
      new Role({
        id: crypto.randomUUID(),
        accountId,
        name,
        description,
        level,
        isSystem: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    return [
      make(
        "Owner",
        RoleLevel.OWNER,
        "Full control. Cannot be removed or demoted without transfer.",
      ),
      make(
        "Admin",
        RoleLevel.ADMIN,
        "Manage members, invitations, and account settings.",
      ),
      make("Member", RoleLevel.MEMBER, "Standard access to account resources."),
    ];
  }

  static create(params: {
    accountId: string;
    name: string;
    description?: string;
    level: number;
  }): Role {
    const now = new Date();
    return new Role({
      id: crypto.randomUUID(),
      accountId: params.accountId,
      name: params.name.trim(),
      description: params.description ?? null,
      level: params.level,
      isSystem: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: RoleProps): Role {
    return new Role(props);
  }

  // ── Getters ────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string | null {
    return this.props.description;
  }
  get level(): number {
    return this.props.level;
  }
  get isSystem(): boolean {
    return this.props.isSystem;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }

  // ── Business Logic ─────────────────────────────────────────

  rename(name: string, now: Date): void {
    if (this.props.isSystem) throw new ForbiddenError("System roles cannot be renamed");
    if (!name || name.trim().length < 2) throw new ValidationError("Role name too short");
    this.props.name = name.trim();
    this.props.updatedAt = now;
  }

  deactivate(now: Date): void {
    if (this.props.isSystem)
      throw new ForbiddenError("System roles cannot be deactivated");
    this.props.isActive = false;
    this.props.updatedAt = now;
  }

  ensureNotSystem(): void {
    if (this.props.isSystem) {
      throw new ForbiddenError("This operation is not permitted on system roles");
    }
  }

  // ── Persistence ────────────────────────────────────────────

  toPersistence(): RoleProps {
    return { ...this.props };
  }
}
