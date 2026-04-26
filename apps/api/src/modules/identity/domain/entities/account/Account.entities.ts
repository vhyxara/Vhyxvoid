import { AccountStatus, AccountType } from "@/generated/prisma";

export interface AccountProps {
  id: string;
  name: string | null;
  type: AccountType;
  status: AccountStatus;
  createdById: string; // immutable — who originally created this account
  graceEndsAt: Date | null; // set when status transitions to PAST_DUE / RESTRICTED
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class Account {
  private constructor(private props: AccountProps) {}
  /**
   * Auto-created during user registration. One personal account per user.
   * Name is null — the UI should display the user's full name instead.
   */
  static createPersonal(ownerUserId: string, firstName?: string): Account {
    const now = new Date();
    return new Account({
      id: crypto.randomUUID(),
      // name: null,
      name: firstName ? `${firstName}'s Workspace` : "Personal Workspace",
      type: AccountType.PERSONAL,
      status: AccountStatus.ACTIVE,
      createdById: ownerUserId, // ← FIX: was silently dropped before
      graceEndsAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  /**
   * Explicitly created by a user who wants a team/org workspace.
   */
  static createOrganization(params: {
    name: string;
    createdById: string;
  }): Account {
    if (!params.name || params.name.trim().length < 2) {
      throw new Error("Organization name must be at least 2 characters");
    }
    const now = new Date();
    return new Account({
      id: crypto.randomUUID(),
      name: params.name.trim(),
      type: AccountType.ORGANIZATION,
      status: AccountStatus.ACTIVE,
      createdById: params.createdById,
      graceEndsAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  static rehydrate(props: AccountProps): Account {
    return new Account(props);
  }

  // ── Getters ────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get name(): string | null {
    return this.props.name;
  }
  get type(): AccountType {
    return this.props.type;
  }
  get status(): AccountStatus {
    return this.props.status;
  }
  get createdById(): string {
    return this.props.createdById;
  }
  get graceEndsAt(): Date | null {
    return this.props.graceEndsAt;
  }
  get isPersonal(): boolean {
    return this.props.type === AccountType.PERSONAL;
  }
  get isOrganization(): boolean {
    return this.props.type === AccountType.ORGANIZATION;
  }
  get isActive(): boolean {
    return this.props.status === AccountStatus.ACTIVE;
  }
  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
  // ── Business Logic ─────────────────────────────────────────

  rename(name: string, now: Date): void {
    if (this.isPersonal) throw new Error("Cannot rename a personal account");
    if (!name || name.trim().length < 2) throw new Error("Name too short");
    this.props.name = name.trim();
    this.props.updatedAt = now;
  }

  suspend(now: Date): void {
    this.props.status = AccountStatus.SUSPENDED;
    this.props.updatedAt = now;
  }

  activate(now: Date): void {
    this.props.status = AccountStatus.ACTIVE;
    this.props.graceEndsAt = null;
    this.props.updatedAt = now;
  }

  markPastDue(graceEndsAt: Date, now: Date): void {
    this.props.status = AccountStatus.PAST_DUE;
    this.props.graceEndsAt = graceEndsAt;
    this.props.updatedAt = now;
  }

  cancel(now: Date): void {
    this.props.status = AccountStatus.CANCELED;
    this.props.updatedAt = now;
  }

  softDelete(now: Date): void {
    this.props.status = AccountStatus.DELETED;
    this.props.deletedAt = now;
    this.props.updatedAt = now;
  }

  ensureActive(): void {
    if (this.props.deletedAt) throw new Error("Account has been deleted");
    if (this.props.status === AccountStatus.SUSPENDED)
      throw new Error("Account is suspended");
    if (this.props.status === AccountStatus.CANCELED)
      throw new Error("Account is canceled");
  }

  // ── Persistence ────────────────────────────────────────────

  toPersistence(): AccountProps {
    return { ...this.props };
  }
}
