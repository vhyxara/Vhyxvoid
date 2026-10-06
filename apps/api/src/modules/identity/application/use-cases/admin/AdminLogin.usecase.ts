// identity/application/usecases/admin/AdminLoginUseCase.ts
// import { AdminTTL } from '@/AGradeDDD/constant/ttl';
import { AdminTTL } from "@/core/constant/ttl.constant";
import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { BcryptPasswordHasher } from "@/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { UnauthorizedError } from "@/core/errors/error.format";

// Same cost as a real bcrypt check, so response time doesn't reveal which
// admin emails exist (mirrors Login.usecase.ts, audit M15).
const DUMMY_BCRYPT_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8.LQKfNMbOdRv1C2b0eb3U2cG8Nn2G";

export class AdminLoginUseCase {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly jwtService: RS256JwtService,
    private readonly tokenGenerator: CryptoTokenGenerator,
    private readonly passwordHasher: BcryptPasswordHasher,
  ) {}

  async execute(
    email: string,
    password: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    admin: {
      id: string;
      email: string;
      fullName: string;
      isSuperAdmin: boolean;
    };
  }> {
    // 1️⃣ Find admin
    const admin = await this.uow.adminUserRepository.findByEmail(email);
    if (!admin) {
      await this.passwordHasher.compare(password, DUMMY_BCRYPT_HASH).catch(() => false);
      throw new UnauthorizedError("Invalid credentials");
    }

    const now = new Date();
    admin.ensureCanLogin(now);

    // Lockout after repeated failures (same scheme as users).
    const lock = await this.uow.prisma.adminUser.findUnique({ where: { id: admin.id }, select: { lockedUntil: true } });
    if (lock?.lockedUntil && lock.lockedUntil > now) {
      const minutes = Math.ceil((lock.lockedUntil.getTime() - now.getTime()) / 60_000);
      throw new UnauthorizedError(`Account is temporarily locked. Try again in ${minutes} minute(s).`);
    }

    // 2️⃣ Verify password
    const isValid = await this.passwordHasher.compare(
      password,
      admin.passwordHash,
    );

    if (!isValid) {
      // One atomic UPDATE, so parallel guesses all count.
      await this.uow.prisma.$executeRaw`
        UPDATE "AdminUser"
        SET "failedLoginAttempts" = "failedLoginAttempts" + 1,
            "lockedUntil" = CASE WHEN "failedLoginAttempts" + 1 >= ${AdminTTL.ADMIN_MAX_FAILED_LOGINS}
                                 THEN ${new Date(now.getTime() + AdminTTL.ADMIN_LOCKOUT_MS)}
                                 ELSE "lockedUntil" END
        WHERE id = ${admin.id}`;
      throw new UnauthorizedError("Invalid credentials");
    }

    // Correct password: clear the failure count (outside the transaction
    // below, which locks this row through adminUserRepository.save).
    await this.uow.prisma.adminUser.update({ where: { id: admin.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });

    // 3️⃣ Wrap success path in transaction
    return this.uow.execute(
      async ({
        adminUserRepository,
        adminSessionRepository,
        adminAuditLogRepository,
      }) => {
        // Record login
        admin.recordLogin(now);
        await adminUserRepository.save(admin);

        // Create session
        const rawRefreshToken = this.tokenGenerator.generate(64);
        const tokenHash = TokenHasher.hash(rawRefreshToken);

        const sessionData = {
          id: crypto.randomUUID(),
          adminId: admin.id,
          tokenHash,
          // A sign-in lasts at most ADMIN_SESSION_ABSOLUTE_MS, however often it refreshes.
          expiresAt: new Date(
            now.getTime() + Math.min(AdminTTL.ADMIN_REFRESH_TOKEN_TTL_MS, AdminTTL.ADMIN_SESSION_ABSOLUTE_MS),
          ),
          revokedAt: null,
          createdAt: now,
          ipAddress,
          userAgent,
          absoluteExpiresAt: new Date(now.getTime() + AdminTTL.ADMIN_SESSION_ABSOLUTE_MS),
        };

        await adminSessionRepository.save(sessionData);

        // Generate access token (15 minutes)
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

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: admin.id,
          action: AuditAction.ADMIN_LOGIN,
          targetType: "AdminUser",
          targetId: admin.id,
          metadata: {
            ipAddress,
            userAgent,
            statusCode: 200,
          },
        });

        await adminAuditLogRepository.save(auditLog);

        return {
          accessToken,
          refreshToken: rawRefreshToken,
          expiresIn: AdminTTL.ADMIN_TOKEN_TTL_SECONDS,
          admin: {
            id: admin.id,
            email: admin.email,
            fullName: admin.fullName,
            isSuperAdmin: admin.isSuperAdmin,
          },
        };
      },
    );
  }
}

// ============================================

// ============================================

// ============================================
