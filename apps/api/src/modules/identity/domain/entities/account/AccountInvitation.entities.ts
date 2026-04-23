import { InvitationStatus } from "@/generated/prisma";
import crypto from "crypto";
import { Role } from "@/modules/identity/domain/entities/account/Role.entities";

export interface AccountInvitationProps {
  id: string;
  accountId: string;
  email: string;
  roleId: string; // FK → Role (the role the invitee will receive)
  roleLevel: number; // denormalized — for display and fast checks
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  canceledAt: Date | null;
  invitedById: string; // FK → User (who sent the invite)
  createdAt: Date;
}
export class AccountInvitation {
  private constructor(private props: AccountInvitationProps) {}

  // ── Factories ──────────────────────────────────────────────

  static create(params: {
    accountId: string;
    email: string;
    role: Role;
    invitedById: string;
    ttlMs: number;
    tokenHash: string;
  }): AccountInvitation {
    const now = new Date();
    return new AccountInvitation({
      id: crypto.randomUUID(),
      accountId: params.accountId,
      email: params.email.toLowerCase().trim(),
      roleId: params.role.id,
      roleLevel: params.role.level,
      tokenHash: params.tokenHash,
      status: InvitationStatus.PENDING,
      expiresAt: new Date(now.getTime() + params.ttlMs),
      acceptedAt: null,
      canceledAt: null,
      invitedById: params.invitedById,
      createdAt: now,
    });
  }

  static rehydrate(props: AccountInvitationProps): AccountInvitation {
    return new AccountInvitation(props);
  }

  // ── Getters ────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get email(): string {
    return this.props.email;
  }
  get roleId(): string {
    return this.props.roleId;
  }
  get roleLevel(): number {
    return this.props.roleLevel;
  }
  get tokenHash(): string {
    return this.props.tokenHash;
  }
  get status(): InvitationStatus {
    return this.props.status;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get acceptedAt(): Date | null {
    return this.props.acceptedAt;
  }
  get invitedById(): string {
    return this.props.invitedById;
  }

  // ── Business Logic ─────────────────────────────────────────

  ensureValid(now: Date): void {
    if (this.props.status !== InvitationStatus.PENDING) {
      throw new Error(
        `Invitation is no longer valid (status: ${this.props.status})`,
      );
    }
    if (this.props.expiresAt <= now) {
      throw new Error("Invitation has expired");
    }
  }

  markAccepted(now: Date): void {
    this.props.status = InvitationStatus.ACCEPTED;
    this.props.acceptedAt = now;
  }

  cancel(now: Date): void {
    this.props.status = InvitationStatus.CANCELED;
    this.props.canceledAt = now;
  }

  // ── Persistence ────────────────────────────────────────────

  toPersistence(): AccountInvitationProps {
    return { ...this.props };
  }
}
