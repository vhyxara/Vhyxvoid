// identity/application/usecases/admin/AdminRefreshTokenUseCase.ts
import { AdminTTL } from "@/core/constant/ttl.constant";
import { AdminAuditLog } from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { UnauthorizedError } from "@/core/errors/error.format";

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

    return this.uow.execute(
      async ({
        adminSessionRepository,
        adminUserRepository,
        adminAuditLogRepository,
      }) => {
        // Find session
        const session = await adminSessionRepository.findByTokenHash(tokenHash);
        if (!session) {
          throw new UnauthorizedError("Invalid refresh token");
        }

        if (session.revokedAt) {
          // Suspicious reuse - revoke all sessions
          await adminSessionRepository.revokeAllByAdminId(session.adminId);
          throw new UnauthorizedError(
            "Refresh token reuse detected. All sessions revoked.",
          );
        }

        if (session.expiresAt <= now) {
          throw new UnauthorizedError("Refresh token expired");
        }

        // Load admin
        const admin = await adminUserRepository.findById(session.adminId);
        if (!admin) {
          throw new UnauthorizedError("Admin not found");
        }

        admin.ensureCanLogin(now);

        // Rotate token
        const newRawRefreshToken = this.tokenGenerator.generate(64);
        const newTokenHash = TokenHasher.hash(newRawRefreshToken);

        // Revoke old session
        await adminSessionRepository.revokeById(session.id);

        // Create new session
        const newSessionData = {
          id: crypto.randomUUID(),
          adminId: admin.id,
          tokenHash: newTokenHash,
          expiresAt: new Date(
            now.getTime() + AdminTTL.ADMIN_REFRESH_TOKEN_TTL_MS,
          ),
          revokedAt: null,
          createdAt: now,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
        };

        await adminSessionRepository.save(newSessionData);

        // New access token
        const accessToken = this.jwtService.sign(
          {
            sub: admin.id,
            email: admin.email,
            type: "admin",
            isSuperAdmin: admin.isSuperAdmin,
          },
          { expiresIn: AdminTTL.ADMIN_TOKEN_TTL_SECONDS },
        );

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: admin.id,
          action: "admin.token_refreshed",
          targetType: "AdminSession",
          targetId: session.id,
        });

        await adminAuditLogRepository.save(auditLog);

        return {
          accessToken,
          refreshToken: newRawRefreshToken,
          expiresIn: AdminTTL.ADMIN_TOKEN_TTL_SECONDS,
        };
      },
    );
  }
}
