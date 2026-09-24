import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import type { AuthStateCache } from "@/modules/identity/infrastructure/auth/AuthStateCache.service";

type UserAuthInvalidator = Pick<AuthStateCache, "invalidateUser">;
const NOOP_INVALIDATOR: UserAuthInvalidator = { invalidateUser: async () => {} };

// Logout revokes the refresh session AND bumps the user's tokenVersion, so the
// logged-out device's access token stops working immediately (audit H2). Other
// devices keep their refresh sessions: their next request gets a 401 and they
// refresh silently to the new version (apps/web refreshes on 401). Binding
// access tokens to a session id instead would break on every refresh, since
// rotation creates a new session row, and tabs would revoke each other.

export class LogoutUseCase {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly authState: UserAuthInvalidator = NOOP_INVALIDATOR,
  ) {}

  async execute(rawRefreshToken: string) {
    const now = new Date();
    const tokenHash = TokenHasher.hash(rawRefreshToken);
    const userId = await this.uow.execute(
      async ({ sessionRepository, userRepository }) => {
        const session = await sessionRepository.findByTokenHash(tokenHash);
        if (!session || session.isRevoked()) {
          return null; // idempotent logout
        }

        session.revoke(now);
        await sessionRepository.save(session);

        const user = await userRepository.findById(session.userId);
        if (user) {
          user.incrementTokenVersion(now);
          await userRepository.save(user);
        }
        return session.userId;
      },
    );
    if (userId) await this.authState.invalidateUser(userId);
  }
}

export class LogoutAllUseCase {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly authState: UserAuthInvalidator = NOOP_INVALIDATOR,
  ) {}

  async execute(userId: string) {
    const now = new Date();

    const result = await this.uow.execute(
      async ({ sessionRepository, userRepository }) => {
        await sessionRepository.revokeAllByUserId(userId, now);
        const user = await userRepository.findById(userId);
        if (user) {
          user.incrementTokenVersion(now);
          await userRepository.save(user);
        }
        return { success: true };
      },
    );
    await this.authState.invalidateUser(userId);
    return result;
  }
}
