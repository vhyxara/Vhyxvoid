import { RoleLevel } from "@/core/constant/account.constant";
import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(2, "Organization name must be at least 2 characters"),
});

export const inviteMemberSchema = z.object({
  email: z.string().email("Must be a valid email"),
  roleLevel: z.nativeEnum(RoleLevel, {
    error: () => ({ message: "roleLevel must be 10 (MEMBER) or 70 (ADMIN)" }),
  }),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
});

export const changeMemberRoleSchema = z.object({
  newRoleLevel: z.nativeEnum(RoleLevel, {
    error: () => ({
      message: "newRoleLevel must be 10 (MEMBER) or 70 (ADMIN)",
    }),
  }),
});

export const transferOwnershipSchema = z.object({
  targetUserId: z.string().uuid("targetUserId must be a valid UUID"),
});

export const accountIdParamSchema = z.object({
  accountId: z.string().uuid(),
});

export const memberParamSchema = z.object({
  accountId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const getMembersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(["roleLevel", "joinedAt"]).default("joinedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

export const renameOrganizationSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
});

export const invitationParamSchema = z.object({
  accountId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

export const listInvitationsQuerySchema = z.object({
  status: z.enum(["PENDING", "ACCEPTED", "EXPIRED", "CANCELED"]).optional(),
});

export type GetMembersQuery = z.infer<typeof getMembersQuerySchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
export type AccountIdParam = z.infer<typeof accountIdParamSchema>;
export type MemberParam = z.infer<typeof memberParamSchema>;
export type InvitationParam = z.infer<typeof invitationParamSchema>;
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;
