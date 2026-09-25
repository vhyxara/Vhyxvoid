// Creates a user's personal workspace (account + system roles + owner
// membership) if they have none yet. Called once the user proves they own
// their email address: by the verification link (VerifyEmail) or by the
// "finish creating your account" password link (ResetPassword on an
// unverified user). Runs inside the caller's unit of work.

import { generateAccountSlug } from "@/core/utils/slug.util";
import { Account } from "@/modules/identity/domain/entities/account/Account.entities";
import { AccountMembership } from "@/modules/identity/domain/entities/account/AccountMember.entities";
import { Role } from "@/modules/identity/domain/entities/account/Role.entities";
import type { User } from "@/modules/identity/domain/entities/user/User.entities";

const MAX_SLUG_ATTEMPTS = 5;

type Repos = {
  accountRepository: {
    findByUserId(userId: string): Promise<unknown[]>;
    findBySlug(slug: string): Promise<unknown | null>;
    save(account: Account): Promise<unknown>;
  };
  roleRepository: { saveBatch(roles: Role[]): Promise<unknown> };
  membershipRepository: { save(m: AccountMembership): Promise<unknown> };
};

export async function ensurePersonalAccount(user: User, repos: Repos, now: Date): Promise<void> {
  const existing = await repos.accountRepository.findByUserId(user.id);
  if (existing.length > 0) return;

  const personalAccount = Account.createPersonal(user.id, user.firstName);
  // The slug always carries a random suffix (audit H11), so a taken one is a
  // random collision: draw again.
  for (let attempt = 1; ; attempt++) {
    if (!(await repos.accountRepository.findBySlug(personalAccount.slug!))) break;
    if (attempt >= MAX_SLUG_ATTEMPTS) {
      throw new Error("Could not allocate a unique account slug");
    }
    personalAccount.setSlug(generateAccountSlug(personalAccount.name), now);
  }
  await repos.accountRepository.save(personalAccount);

  const roles = Role.seedSystemRoles(personalAccount.id);
  await repos.roleRepository.saveBatch(roles);
  await repos.membershipRepository.save(AccountMembership.createOwner(personalAccount.id, user.id, roles[0]));
}
