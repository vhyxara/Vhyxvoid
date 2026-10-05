// identity/application/usecases/admin/AdminRefreshTokenUseCase.ts
//
// Admin refresh-token rotation, with the same protections as the user flow
// (RefreshSession, audit H10):
// 1. The session row is locked (SELECT ... FOR UPDATE) inside a real
//    transaction, so two concurrent refreshes of one token can't both mint
//    a session.
// 2. A token presented again within REFRESH_ROTATION_GRACE_MS of being
//    rotated (two tabs refreshing at once) gets the same successor back
//    instead of tripping reuse detection and logging the admin out.
// 3. Anything else presented after rotation is treated as theft: every
//    session of that admin is revoked (after the transaction, so the
//    revocation survives the 401).
import { AdminTTL, REFRESH_ROTATION_GRACE_MS } from "@/core/constant/ttl.constant";
import { AuditAction } from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { RefreshSuccessorCipher } from "@/modules/identity/infrastructure/crypto/RefreshSuccessorCipher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { UnauthorizedError } from "@/core/errors/error.format";

type Outcome =
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "reuse"; adminId: string }
  | { kind: "ok"; adminId: string; refreshToken: string; sessionId: string };

export class AdminRefreshTokenUseCase {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly jwtService: RS256JwtService,
    private readonly tokenGenerator: CryptoTokenGenerator,
  ) {}

  async execute(rawRefreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const now = new Date();
    const tokenHash = TokenHasher.hash(rawRefreshToken);
    const prisma = this.uow.prisma;

    const outcome: Outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AdminSession" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const session = await tx.adminSession.findUnique({ where: { tokenHash } });
      if (!session) return { kind: "invalid" };

      if (session.revokedAt) {
        const withinGrace = now.getTime() - session.revokedAt.getTime() <= REFRESH_ROTATION_GRACE_MS;
        if (withinGrace && session.replacedById && session.replacementTokenCipher) {
          const successor = await tx.adminSession.findUnique({ where: { id: session.replacedById } });
          const raw = RefreshSuccessorCipher.decrypt(session.replacementTokenCipher);
          if (successor && !successor.revokedAt && successor.expiresAt > now && raw && TokenHasher.hash(raw) === successor.tokenHash) {
            return { kind: "ok", adminId: session.adminId, refreshToken: raw, sessionId: successor.id };
          }
        }
        return { kind: "reuse", adminId: session.adminId };
      }
      if (session.expiresAt <= now) return { kind: "expired" };

      const newRaw = this.tokenGenerator.generate(64);
      const successor = await tx.adminSession.create({
        data: {
          id: crypto.randomUUID(),
          adminId: session.adminId,
          tokenHash: TokenHasher.hash(newRaw),
          expiresAt: new Date(now.getTime() + AdminTTL.ADMIN_REFRESH_TOKEN_TTL_MS),
          createdAt: now,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
        },
      });
      await tx.adminSession.update({
        where: { id: session.id },
        data: { revokedAt: now, replacedById: successor.id, replacementTokenCipher: RefreshSuccessorCipher.encrypt(newRaw) },
      });
      // Ciphertexts past the grace window are never read again.
      await tx.adminSession.updateMany({
        where: { adminId: session.adminId, replacementTokenCipher: { not: null }, revokedAt: { lt: new Date(now.getTime() - REFRESH_ROTATION_GRACE_MS) } },
        data: { replacementTokenCipher: null },
      });
      await tx.adminAuditLog.create({
        data: { adminId: session.adminId, action: AuditAction.ADMIN_TOKEN_REFRESHED, targetType: "AdminSession", targetId: session.id },
      });
      return { kind: "ok", adminId: session.adminId, refreshToken: newRaw, sessionId: successor.id };
    });

    if (outcome.kind === "invalid") throw new UnauthorizedError("Invalid refresh token");
    if (outcome.kind === "expired") throw new UnauthorizedError("Refresh token expired");
    if (outcome.kind === "reuse") {
      await this.uow.adminSessionRepository.revokeAllByAdminId(outcome.adminId);
      throw new UnauthorizedError("Refresh token reuse detected. All sessions revoked.");
    }

    const admin = await this.uow.adminUserRepository.findById(outcome.adminId);
    if (!admin) throw new UnauthorizedError("Admin not found");
    admin.ensureCanLogin(now);

    const accessToken = this.jwtService.sign(
      {
        sub: admin.id,
        email: admin.email,
        type: "admin",
        isSuperAdmin: admin.isSuperAdmin,
        tokenVersion: admin.tokenVersion,
      },
      { expiresIn: AdminTTL.ADMIN_TOKEN_TTL_SECONDS },
    );

    return { accessToken, refreshToken: outcome.refreshToken, expiresIn: AdminTTL.ADMIN_TOKEN_TTL_SECONDS };
  }
}
