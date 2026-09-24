import { UnauthorizedError } from "@/core/errors/error.format";
import { TTL } from "@/core/constant/ttl.constant";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

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

    return this.uow.execute(async ({ sessionRepository, userRepository }) => {
      // 1️⃣ Find session
      const session = await sessionRepository.findByTokenHash(tokenHash);
      if (!session) {
        throw new UnauthorizedError("Invalid refresh token");
      }

      // Expired token
      if (session.isExpired(now)) {
        throw new UnauthorizedError("Refresh token expired");
      }
      if (session.isRevoked()) {
        //  suspicious reuse detected
        await sessionRepository.revokeAllByUserId(session.userId, now);
        throw new UnauthorizedError(
          "Refresh token reuse detected. All sessions revoked.",
        );
      }

      //  Load user
      const user = await userRepository.findById(session.userId);
      if (!user) throw new UnauthorizedError("User not found");
      user.ensureCanLogin(now);

      //  Rotate refresh token
      const newRawRefreshToken = this.tokenGenerator.generate(64);
      const newTokenHash = TokenHasher.hash(newRawRefreshToken);
      // session.revoke(now);

      // const newSession = Session.create({
      //   userId: user.id,
      //   tokenHash: newTokenHash,
      //   ttlMs: this.refreshTokenTTL,
      //   ipAddress: session.ipAddress,
      //   userAgent: session.userAgent,
      // });

      const newSession = session.rotate(
        newTokenHash,
        this.refreshTokenTTL,
        now,
      );
      // const newSession = session.rotate(newTokenHash, this.refreshTokenTTL * 1000, now);

      // 4️⃣ Save both sessions (old is revoked, new is active)
      await sessionRepository.save(session); // old revoked
      await sessionRepository.save(newSession); // new active

      // 5️⃣ Generate new access token
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
        refreshToken: newRawRefreshToken,
        expiresIn: TTL.ACCESS_TOKEN_SEC,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      };
    });
  }
}
