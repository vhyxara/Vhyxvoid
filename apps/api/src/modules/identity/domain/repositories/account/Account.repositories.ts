// ── Account ──────────────────────────────────────────────────

import { InvitationStatus } from "@/core/constant/account.constant";
import { Account } from "@/modules/identity/domain/entities/account/Account.entities";
import { AccountInvitation } from "@/modules/identity/domain/entities/account/AccountInvitation.entities";
import { AccountMembership } from "@/modules/identity/domain/entities/account/AccountMember.entities";
import { Role } from "@/modules/identity/domain/entities/account/Role.entities";

export interface AccountRepository {
  save(account: Account): Promise<void>;
  findById(id: string): Promise<Account | null>;
  findByUserId(userId: string): Promise<Account[]>;
  findBySlug(slug: string): Promise<Account | null>;
}

// ── Role ─────────────────────────────────────────────────────

export interface RoleRepository {
  save(role: Role): Promise<void>;
  saveBatch(roles: Role[]): Promise<void>;
  findById(id: string): Promise<Role | null>;
  findByAccountId(accountId: string): Promise<Role[]>;
  /**
   * Find the system role for an account by its numeric level.
   * Used when changing roles (look up the system Role for a given RoleLevel).
   */
  findSystemRoleByLevel(accountId: string, level: number): Promise<Role | null>;
}

// ── AccountMembership ─────────────────────────────────────────

export interface MembershipRepository {
  save(membership: AccountMembership): Promise<void>;
  findByAccountAndUser(
    accountId: string,
    userId: string,
  ): Promise<AccountMembership | null>;
  findAllByAccount(accountId: string): Promise<AccountMembership[]>;
  findAllByUser(userId: string): Promise<AccountMembership[]>;
  /**
   * Find the owner membership of a user's personal account.
   * Used as the "can create organizations" permission check.
   */
  findOwnerPersonalAccount(userId: string): Promise<string | null>;
  countOwners(accountId: string): Promise<number>;
  delete(accountId: string, userId: string): Promise<void>;
}

// ── AccountInvitation ─────────────────────────────────────────

export interface InvitationRepository {
  save(invitation: AccountInvitation): Promise<void>;
  findById(id: string): Promise<AccountInvitation | null>;
  findByTokenHash(tokenHash: string): Promise<AccountInvitation | null>;
  findPendingByEmail(
    accountId: string,
    email: string,
  ): Promise<AccountInvitation | null>;
  findByAccountId(
    accountId: string,
    options?: { status?: InvitationStatus; limit?: number },
  ): Promise<AccountInvitation[]>;
}
