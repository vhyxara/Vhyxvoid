import { PrismaUserRepository } from "@/modules/identity/infrastructure/prisma/user/PrismaUserRepository";
import { PrismaClient, Prisma } from "@/generated/prisma";
import { PrismaSessionRepository } from "@/modules/identity/infrastructure/prisma/user/PrismaSessionRepository";
import { PrismaEmailTokenRepository } from "@/modules/identity/infrastructure/prisma/user/PrismaEmailTokenRepository";
import { PrismaAccountRepository } from "@/modules/identity/infrastructure/prisma/account/PrismaAccountRepository";
import { PrismaMembershipRepository } from "@/modules/identity/infrastructure/prisma/account/PrismaMembershipRepository";
import { PrismaAuditLogRepository } from "@/modules/identity/infrastructure/prisma/user/PrismaAuditLogRepository";
import { PrismaAccountInvitationRepository } from "@/modules/identity/infrastructure/prisma/account/PrismaAccountInvitationRepository";
import { PrismaRoleRepository } from "@/modules/identity/infrastructure/prisma/account/PrismaRoleRepository";
import { PrismaAdminUserRepository } from "@/modules/identity/infrastructure/prisma/admin/PrismaAdminRepositories";
import { PrismaAdminRoleRepository } from "@/modules/identity/infrastructure/prisma/admin/PrismaAdminRoleRepository";
import { PrismaAdminAbilityRepository } from "@/modules/identity/infrastructure/prisma/admin/PrismaAdminAbilityRepository";
import { PrismaAdminSessionRepository } from "@/modules/identity/infrastructure/prisma/admin/PrismaAdminSessionRepository";
import { PrismaAdminAuditLogRepository } from "@/modules/identity/infrastructure/prisma/admin/PrismaAdminAuditLogRepository";
import { TunnelRequestRepository } from "@/modules/identity/domain/repositories/tunnel/TunnelRequest.repositories";
import { TunnelSessionRepository } from "@/modules/identity/domain/repositories/tunnel/TunnelSession.repositories";
import { PrismaAccountBillingRepository } from "@/modules/billing/domain/repositories/PrismaAccountBillingRepository";
import { PrismaInvoiceRepository } from "@/modules/billing/domain/repositories/PrismaInvoiceRepository";
import { PrismaSubscriptionRepository } from "@/modules/billing/domain/repositories/PrismaSubscriptionRepository";
import { PrismaNotificationRepository } from "@/modules/notification/infrastructure/prisma/PrismaNotificationRepository";
// import { PasswordResetTokenRepository } from "@/modules/identity/domain/repositories/user/PasswordResetToken.repositories";
import { PrismaPasswordResetTokenRepository } from "@/modules/identity/infrastructure/prisma/user/PrismaPasswordResetTokenRepository";

// import { PrismaAdminAbilityRepository, PrismaAdminAuditLogRepository, PrismaAdminRoleRepository, PrismaAdminSessionRepository, PrismaAdminUserRepository } from './admin/PrismaAdminRepositories';

export class PrismaUnitOfWork {
  public readonly prisma: PrismaClient;

  public readonly userRepository: PrismaUserRepository;
  public readonly sessionRepository: PrismaSessionRepository;
  public readonly emailTokenRepository: PrismaEmailTokenRepository; // ✅ ADD THIS
  // public readonly refreshTokenRepository : refreshTokenRepository
  public readonly accountRepository: PrismaAccountRepository;
  public readonly membershipRepository: PrismaMembershipRepository;
  public readonly auditLogRepository: PrismaAuditLogRepository;
  public readonly invitationRepository: PrismaAccountInvitationRepository;
  public readonly roleRepository: PrismaRoleRepository;
  // Admin-related repositories
  public readonly adminUserRepository: PrismaAdminUserRepository;
  public readonly adminRoleRepository: PrismaAdminRoleRepository;
  public readonly adminAbilityRepository: PrismaAdminAbilityRepository;
  public readonly adminSessionRepository: PrismaAdminSessionRepository;
  public readonly adminAuditLogRepository: PrismaAdminAuditLogRepository;
  // Billing-related repositories
  public readonly accountBillingRepository: PrismaAccountBillingRepository;
  public readonly invoiceRepository: PrismaInvoiceRepository;
  public readonly subscriptionRepository: PrismaSubscriptionRepository;
  // Tunnel-related repositories
  public readonly tunnelSessionRepository: TunnelSessionRepository;
  public readonly tunnelRequestRepository: TunnelRequestRepository;
  // Notification repositories
  public readonly notificationRepository: PrismaNotificationRepository;
  // In the UoW constructor, add alongside the other repositories:

  // In the UoW interface / execute() params, add:
  public readonly passwordResetTokenRepository: PrismaPasswordResetTokenRepository;

  constructor(private prismaOrTx: PrismaClient | Prisma.TransactionClient) {
    this.prisma = prismaOrTx as PrismaClient;
    this.invitationRepository = new PrismaAccountInvitationRepository(
      prismaOrTx as PrismaClient,
    );
    this.auditLogRepository = new PrismaAuditLogRepository(
      prismaOrTx as PrismaClient,
    );
    this.roleRepository = new PrismaRoleRepository(prismaOrTx as PrismaClient);
    this.accountRepository = new PrismaAccountRepository(
      prismaOrTx as PrismaClient,
    );
    this.membershipRepository = new PrismaMembershipRepository(
      prismaOrTx as PrismaClient,
    );
    this.userRepository = new PrismaUserRepository(prismaOrTx as PrismaClient);
    this.sessionRepository = new PrismaSessionRepository(
      prismaOrTx as PrismaClient,
    );
    this.emailTokenRepository = new PrismaEmailTokenRepository(
      prismaOrTx as PrismaClient,
    );

    this.passwordResetTokenRepository = new PrismaPasswordResetTokenRepository(
      prismaOrTx as PrismaClient,
    );
    // Tunnel repositories
    this.tunnelSessionRepository = new TunnelSessionRepository(
      prismaOrTx as PrismaClient,
    );
    this.tunnelRequestRepository = new TunnelRequestRepository(
      prismaOrTx as PrismaClient,
    );

    // Billing repositories
    this.accountBillingRepository = new PrismaAccountBillingRepository(
      prismaOrTx as PrismaClient,
    );
    this.invoiceRepository = new PrismaInvoiceRepository(
      prismaOrTx as PrismaClient,
    );
    this.subscriptionRepository = new PrismaSubscriptionRepository(
      prismaOrTx as PrismaClient,
    );

    // Notification repositories
    this.notificationRepository = new PrismaNotificationRepository(
      prismaOrTx as PrismaClient,
    );
    // Admin repositories
    this.adminUserRepository = new PrismaAdminUserRepository(
      prismaOrTx as PrismaClient,
    );
    this.adminRoleRepository = new PrismaAdminRoleRepository(
      prismaOrTx as PrismaClient,
    );
    this.adminAbilityRepository = new PrismaAdminAbilityRepository(
      prismaOrTx as PrismaClient,
    );
    this.adminSessionRepository = new PrismaAdminSessionRepository(
      prismaOrTx as PrismaClient,
    );
    this.adminAuditLogRepository = new PrismaAdminAuditLogRepository(
      prismaOrTx as PrismaClient,
    );
  }

  /**
   * Run fn in a REAL database transaction.
   *
   * execute() below never opens one: Prisma 6's generated client constructor
   * returns a proxy, so `this.prisma instanceof PrismaClient` is false even
   * for the root client and execute() always takes its "already in a
   * transaction" branch, running each statement on its own (verified
   * 2026-09-24; api/context.md item 63). Fixing execute() changes the
   * behaviour of every caller (some write then throw and rely on the write
   * surviving), so it's a separate job; this is used only where a
   * transaction is required (refresh rotation, audit H10). A transaction
   * client has no $transaction, which is how an already-open one is detected.
   */
  async transaction<T>(fn: (uow: PrismaUnitOfWork) => Promise<T>): Promise<T> {
    const client = this.prisma as any;
    if (typeof client.$transaction !== "function") return fn(this);
    return client.$transaction(async (tx: Prisma.TransactionClient) =>
      fn(new PrismaUnitOfWork(tx)),
    );
  }

  async execute<T>(fn: (uow: PrismaUnitOfWork) => Promise<T>): Promise<T> {
    // If already in a transaction, just execute
    if (this.prisma instanceof PrismaClient === false) {
      return fn(this);
    }

    // Otherwise, start a new transaction
    return (this.prisma as PrismaClient).$transaction(async (tx) => {
      const transactionalUow = new PrismaUnitOfWork(tx);
      return fn(transactionalUow);
    });
  }
}
