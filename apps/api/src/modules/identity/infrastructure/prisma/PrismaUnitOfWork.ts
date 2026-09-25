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

  /**
   * Queue a side effect (an email, an in-app notification, anything outside
   * this database) to run only once the current transaction has COMMITTED; if
   * it rolls back, the callback is dropped. Outside a transaction it runs at
   * once. Errors are logged, never thrown: the data change has already
   * committed. An arrow property so `async ({ afterCommit }) => ...` works.
   */
  public readonly afterCommit = (fn: () => unknown): void => {
    if (this.isTransactional()) this.afterCommitQueue.push(fn);
    else runAfterCommit(fn);
  };

  private readonly afterCommitQueue: Array<() => unknown>;

  constructor(
    private prismaOrTx: PrismaClient | Prisma.TransactionClient,
    // Shared by every unit of work in one transaction, so a nested execute()
    // queues onto the outer one.
    afterCommitQueue: Array<() => unknown> = [],
  ) {
    this.afterCommitQueue = afterCommitQueue;
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
   * Run fn in a real database transaction: every repository on the unit of
   * work passed to fn uses the transaction client, and a throw rolls back
   * everything fn wrote. Called on a unit of work that is already inside a
   * transaction, fn simply joins it.
   *
   * An open transaction is detected by the client having no $transaction
   * (Prisma's interactive-transaction client doesn't). This used to test
   * `this.prisma instanceof PrismaClient`, which is false for Prisma 6's
   * proxy client, so no transaction was ever opened and every caller ran
   * statement by statement (api/context.md #63).
   *
   * Anything that must persist even though fn then throws (e.g. revoking
   * every session on refresh-token reuse) has to be written after the
   * transaction, not inside it.
   */
  async execute<T>(fn: (uow: PrismaUnitOfWork) => Promise<T>): Promise<T> {
    if (this.isTransactional()) return fn(this);
    const queue: Array<() => unknown> = [];
    const result: T = await (this.prisma as any).$transaction(
      async (tx: Prisma.TransactionClient) => fn(new PrismaUnitOfWork(tx, queue)),
      TRANSACTION_OPTIONS,
    );
    // Committed: now the side effects. (On a throw we never get here.)
    for (const cb of queue) runAfterCommit(cb);
    return result;
  }

  /** True inside an interactive transaction: its client has no $transaction. */
  private isTransactional(): boolean {
    return typeof (this.prisma as any).$transaction !== "function";
  }

  /** Same as execute(); kept for the callers that already use this name. */
  async transaction<T>(fn: (uow: PrismaUnitOfWork) => Promise<T>): Promise<T> {
    return this.execute(fn);
  }
}

function runAfterCommit(fn: () => unknown): void {
  try {
    const out = fn();
    if (out && typeof (out as Promise<unknown>).catch === "function") {
      (out as Promise<unknown>).catch((err) =>
        console.error("[uow] after-commit callback failed", err),
      );
    }
  } catch (err) {
    console.error("[uow] after-commit callback failed", err);
  }
}

// Prisma's interactive-transaction defaults are maxWait 2 s / timeout 5 s.
// Some callbacks hash a password with bcrypt inside the transaction (register,
// password reset, admin creation), which on a loaded box plus Neon round trips
// can approach 5 s; a timeout rolls the whole operation back.
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
