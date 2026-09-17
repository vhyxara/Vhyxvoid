import { PrismaClient } from "@/generated/prisma";
import { Container } from "@/core/container/container";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CreateAbilityUseCase } from "@/modules/identity/application/use-cases/admin/CreateAbility.usecase";
import { RevokeAbilityFromRoleUseCase } from "@/modules/identity/application/use-cases/admin/RevokeAbilityFromRole.usecase";
import { AssignAbilityToRoleUseCase } from "@/modules/identity/application/use-cases/admin/AssignAbilityToRole.usecase";
import { GetAdminAbilitiesUseCase } from "@/modules/identity/application/use-cases/admin/GetAdminAbilities.usecase";
import { VerifyAdminAbilityUseCase } from "@/modules/identity/application/use-cases/admin/VerifyAdminAbility.usecase";
import { CreateApiKeyUseCase } from "@/modules/key-management/application/use-cases/CreateApiKey.usecase";
import { ListApiKeysUseCase } from "@/modules/key-management/application/use-cases/ListApiKeys.usecase";
import { GetApiKeyUseCase } from "@/modules/key-management/application/use-cases/GetApiKey.usecase";
import { UpdateApiKeyUseCase } from "@/modules/key-management/application/use-cases/UpdateApiKey.usecase";
import { RevokeApiKeyUseCase } from "@/modules/key-management/application/use-cases/RevokeApiKey.usecase";
import { RotateApiKeyUseCase } from "@/modules/key-management/application/use-cases/RotateApiKey.usecase";
import { GetApiKeyUsageUseCase } from "@/modules/key-management/application/use-cases/GetApiKeyUsage.usecase";
import { ValidateApiKeyUseCase } from "@/modules/key-management/application/use-cases/ValidateApiKey.usecase";
import { Redis } from "@upstash/redis";
import { CreateCheckoutSessionUseCase } from "@/modules/billing/application/use-cases/billing/CreateCheckoutSession.usecase";
import { CreateBillingPortalSessionUseCase } from "@/modules/billing/application/use-cases/billing/CreateBillingPortalSession.usecase";
import { GetSubscriptionUseCase } from "@/modules/billing/application/use-cases/billing/GetSubscription.usecase";
import { GetInvoicesUseCase } from "@/modules/billing/application/use-cases/billing/GetInvoices.usecase";
import { HandleStripeWebhookUseCase } from "@/modules/billing/application/use-cases/webhook/HandleStripeWebhook.usecase";
import { CheckPlanLimitsService } from "@/modules/billing/domain/services/CheckPlanLimits.service";
import { NotificationService } from "@/modules/notification/application/use-cases";
import { RegisterUserUseCase } from "@/modules/identity/application/use-cases/user/Register.usecase";
import { LoginUseCase } from "@/modules/identity/application/use-cases/user/Login.usecase";
import { RefreshTokenUseCase } from "@/modules/identity/application/use-cases/user/RefreshSession.usecase";
import { VerifyEmailUseCase } from "@/modules/identity/application/use-cases/user/VerifyEmail.usecase";
import {
  LogoutAllUseCase,
  LogoutUseCase,
} from "@/modules/identity/application/use-cases/user/Logout.usecase";
import { CreateOrganizationUseCase } from "@/modules/identity/application/use-cases/account/CreateOrganization.usecase";
import { InviteMemberUseCase } from "@/modules/identity/application/use-cases/account/InviteMember.usecase";
import { AcceptInvitationUseCase } from "@/modules/identity/application/use-cases/account/AcceptInvitation.usecase";
import { ChangeMemberRoleUseCase } from "@/modules/identity/application/use-cases/account/ChangeMemberRole.usecase";
import { RemoveMemberUseCase } from "@/modules/identity/application/use-cases/account/RemoveMember.usecase";
import { TransferOwnershipUseCase } from "@/modules/identity/application/use-cases/account/TransferOwnership.usecase";
import { AdminLoginUseCase } from "@/modules/identity/application/use-cases/admin/AdminLogin.usecase";
import { AdminRefreshTokenUseCase } from "@/modules/identity/application/use-cases/admin/AdminRefreshToken.usecase";
import { CreateAdminUseCase } from "@/modules/identity/application/use-cases/admin/CreateAdmin.usecase";
import { CreateRoleUseCase } from "@/modules/identity/application/use-cases/admin/CreateRole.usecase";
import { AssignRoleToAdminUseCase } from "@/modules/identity/application/use-cases/admin/AssignRoleToAdmin.usecase";
import { RevokeRoleFromAdminUseCase } from "@/modules/identity/application/use-cases/admin/RevokeRoleFromAdmin.usecase";
import { GetAccountMembersUseCase } from "@/modules/identity/application/use-cases/user/GetAccountMembers.usecase";
import { RequestPasswordResetUseCase } from "@/modules/identity/application/use-cases/user/RequestPasswordReset.usecase";
import { ResetPasswordUseCase } from "@/modules/identity/application/use-cases/user/ResetPassword.usecase";
// import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
// import { NotificationService } from "@/modules/notification/application/use-cases";

declare module "fastify" {
  interface FastifyInstance {
    // Core
    prisma: PrismaClient;
    container: Container;
    // uow.membershipRepository / .tunnelSessionRepository / .tunnelRequestRepository
    // etc. are reached via this nested PrismaUnitOfWork, not as their own
    // top-level FastifyInstance properties — three stale duplicate
    // declarations that pointed at the top level directly (never
    // decorated, never read) were removed 2026-09-17 in the decorator
    // sweep that also removed TokenHasher/AdminAuditLog (both consumed as
    // statically-imported classes, e.g. TokenHasher.hash(...), never via
    // this instance). See internal-tools/api/decision.md, 2026-09-17.
    uow: PrismaUnitOfWork;
    jwtService: RS256JwtService;
    redis: Redis;
    // tokenGenerator: CryptoTokenGenerator;
    // uow: PrismaUnitOfWork & {
    //   apiKeyRepository?: any;
    //   securityEventRepository?: any;
    //   auditLogRepository?: any;
    // membershipRepository?: any;
    // };

    // ── User Auth
    registerUserUseCase: RegisterUserUseCase;
    loginUseCase: LoginUseCase;
    refreshTokenUseCase: RefreshTokenUseCase;
    verifyEmailUseCase: VerifyEmailUseCase;
    logoutUseCase: LogoutUseCase;
    logoutAllUseCase: LogoutAllUseCase;
    getAccountMembersUseCase: GetAccountMembersUseCase;
    requestPasswordResetUseCase: RequestPasswordResetUseCase;
    resetPasswordUseCase: ResetPasswordUseCase;

    // ── Account
    createOrganizationUseCase: CreateOrganizationUseCase;
    inviteMemberUseCase: InviteMemberUseCase;
    acceptInvitationUseCase: AcceptInvitationUseCase;
    changeMemberRoleUseCase: ChangeMemberRoleUseCase;
    removeMemberUseCase: RemoveMemberUseCase;
    transferOwnershipUseCase: TransferOwnershipUseCase;

    // ── Admin
    adminLoginUseCase: AdminLoginUseCase;
    adminRefreshTokenUseCase: AdminRefreshTokenUseCase;
    createAdminUseCase: CreateAdminUseCase;
    createRoleUseCase: CreateRoleUseCase;
    assignRoleToAdminUseCase: AssignRoleToAdminUseCase;
    revokeRoleFromAdminUseCase: RevokeRoleFromAdminUseCase;
    verifyAdminAbilityUseCase: VerifyAdminAbilityUseCase;
    getAdminAbilitiesUseCase: GetAdminAbilitiesUseCase;
    assignAbilityToRoleUseCase: AssignAbilityToRoleUseCase;
    revokeAbilityFromRoleUseCase: RevokeAbilityFromRoleUseCase;
    createAbilityUseCase: CreateAbilityUseCase;

    // ── API Key use cases
    createApiKeyUseCase: CreateApiKeyUseCase;
    listApiKeysUseCase: ListApiKeysUseCase;
    getApiKeyUseCase: GetApiKeyUseCase;
    updateApiKeyUseCase: UpdateApiKeyUseCase;
    revokeApiKeyUseCase: RevokeApiKeyUseCase;
    rotateApiKeyUseCase: RotateApiKeyUseCase;
    getApiKeyUsageUseCase: GetApiKeyUsageUseCase;
    validateApiKeyUseCase: ValidateApiKeyUseCase;

    // --- Billing / Subscription
    createCheckoutSessionUseCase: CreateCheckoutSessionUseCase;
    createBillingPortalSessionUseCase: CreateBillingPortalSessionUseCase;
    getSubscriptionUseCase: GetSubscriptionUseCase;
    getInvoicesUseCase: GetInvoicesUseCase;
    handleStripeWebhookUseCase: HandleStripeWebhookUseCase;
    checkPlanLimitsService: CheckPlanLimitsService;

    // Notification
    notificationService: NotificationService;

    // requireAbility: RequireAbilityPlugin;

    // ── Guards
    userAuthGuard(
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ): Promise<void>;

    adminAuthGuard(
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ): Promise<void>;
    requireAbility: (
      ability: string,
    ) => (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;

    requireSuperAdmin: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
    };

    admin?: {
      id: string;
      email: string;
      isSuperAdmin: boolean;
    };
  }
}
