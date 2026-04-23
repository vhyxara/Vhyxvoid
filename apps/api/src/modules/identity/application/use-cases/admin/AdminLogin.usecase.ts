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
      throw new UnauthorizedError("Invalid credentials");
    }

    const now = new Date();
    admin.ensureCanLogin(now);

    // 2️⃣ Verify password
    const isValid = await this.passwordHasher.compare(
      password,
      admin.passwordHash,
    );

    if (!isValid) {
      throw new UnauthorizedError("Invalid credentials");
    }

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
          expiresAt: new Date(
            now.getTime() + AdminTTL.ADMIN_REFRESH_TOKEN_TTL_MS,
          ),
          revokedAt: null,
          createdAt: now,
          ipAddress,
          userAgent,
        };

        await adminSessionRepository.save(sessionData);

        // Generate access token (15 minutes)
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
