import { UnauthorizedError } from "@/core/errors/error.format";
import { TTL, REFRESH_ROTATION_GRACE_MS } from "@/core/constant/ttl.constant";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { RefreshSuccessorCipher } from "@/modules/identity/infrastructure/crypto/RefreshSuccessorCipher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

// Refresh-token rotation (audit H10):
//
// 1. The session row is locked (SELECT ... FOR UPDATE) inside a real
//    transaction, so two concurrent refreshes of one token can't both rotate
//    it and mint two live sessions; the second waits, then sees the rotation.
// 2. A token presented again within REFRESH_ROTATION_GRACE_MS of being
//    ROTATED (not logged out) gets the same successor back, provided the
//    successor is still active: two tabs refreshing at once no longer log
//    the user out everywhere.
// 3. Anything else about a revoked token is still reuse: rotated longer ago,
//    logged out, or its successor since revoked. Every session is revoked,
//    and that write happens after the transaction so the error doesn't undo it.

type Outcome =
  | { kind: "ok"; user: RotatedUser; refreshToken: string }
  | { kind: "reuse"; userId: string }
  | { kind: "invalid" }
  | { kind: "expired" };

interface RotatedUser {
  id: string;
  email: string;
  tokenVersion: number;
  firstName?: string | null;
  lastName?: string | null;
}

export class RefreshTokenUseCase {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly jwtService: RS256JwtService,
    private readonly tokenGenerator: CryptoTokenGenerator,
    private readonly refreshTokenTTL: number, // 30 days
  ) {}

  async execute(rawRefreshToken: string) {
    const now = new Date();
    const tokenHash = TokenHasher.hash(rawRefreshToken);

    const outcome: Outcome = await this.uow.transaction(
      async ({ sessionRepository, userRepository }) => {
        const session = await sessionRepository.findByTokenHashForUpdate(tokenHash);
        if (!session) return { kind: "invalid" };
        if (session.isExpired(now)) return { kind: "expired" };

        if (session.isRevoked()) {
          if (session.wasRotatedWithin(now, REFRESH_ROTATION_GRACE_MS)) {
            const successor = await sessionRepository.findById(session.replacedById!);
            const raw = RefreshSuccessorCipher.decrypt(session.replacementTokenCipher!);
            if (successor && successor.isValid(now) && raw && TokenHasher.hash(raw) === successor.tokenHash) {
              const user = await userRepository.findById(session.userId);
              if (!user) return { kind: "invalid" };
              user.ensureCanLogin(now);
              return { kind: "ok", user, refreshToken: raw };
            }
          }
          return { kind: "reuse", userId: session.userId };
        }

        const user = await userRepository.findById(session.userId);
        if (!user) return { kind: "invalid" };
        user.ensureCanLogin(now);

        const newRawRefreshToken = this.tokenGenerator.generate(64);
        const newSession = session.rotate(
          TokenHasher.hash(newRawRefreshToken),
          this.refreshTokenTTL,
          now,
          RefreshSuccessorCipher.encrypt(newRawRefreshToken),
        );
        await sessionRepository.save(session); // old: revoked, points at its successor
        await sessionRepository.save(newSession); // new: active
        // Ciphertexts past the grace window are never read again.
        await sessionRepository.purgeRotationCiphers(
          user.id,
          new Date(now.getTime() - REFRESH_ROTATION_GRACE_MS),
        );
        return { kind: "ok", user, refreshToken: newRawRefreshToken };
      },
    );

    if (outcome.kind === "invalid") throw new UnauthorizedError("Invalid refresh token");
    if (outcome.kind === "expired") throw new UnauthorizedError("Refresh token expired");
    if (outcome.kind === "reuse") {
      await this.uow.sessionRepository.revokeAllByUserId(outcome.userId, now);
      throw new UnauthorizedError("Refresh token reuse detected. All sessions revoked.");
    }

    const { user, refreshToken } = outcome;
    const accessToken = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        tokenVersion: user.tokenVersion,
        type: "user",
      },
      { expiresIn: TTL.ACCESS_TOKEN_SEC }, // same TTL as login
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: TTL.ACCESS_TOKEN_SEC,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }
}
