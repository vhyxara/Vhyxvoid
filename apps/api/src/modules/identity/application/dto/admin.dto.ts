import { z } from "zod";

export const registerUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string(),
  lastName: z.string(),
});

// Strict: email/password are not editable here, so sending them is a 400
// rather than a silently dropped field; a blank name is a 400 rather than a
// 200 that kept the old value.
export const updateAdminSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name cannot be blank").optional(),
    lastName: z.string().trim().min(1, "Last name cannot be blank").optional(),
  })
  .strict()
  .refine((v) => v.firstName !== undefined || v.lastName !== undefined, {
    message: "Provide firstName and/or lastName",
  });

export const createRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

export const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
  reason: z.string().optional(),
});

export const assignAbilitySchema = z.object({
  abilityId: z.string().uuid(),
});

export const auditLogsQuerySchema = z.object({
  adminId: z.string().uuid().optional(),
  action: z.string().optional(),
  targetId: z.string().uuid().optional(),
  limit: z.coerce.number().max(100).default(50),
  offset: z.coerce.number().default(0),
});

export const enableAdminSchema = z.object({});
export const disableAdminSchema = z.object({});
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(32).max(256),
});
export const logoutSchema = z.object({
  refreshToken: z.string().regex(/^[a-f0-9]+$/i).optional(),
});
export const getAdminSchema = z.object({
  adminId: z.string().uuid(),
});
export const listAdminsSchema = z.object({
  status: z.string().optional(),
});
export const createAbilitySchema = z.object({
  action: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
});
export const getRoleAbilitiesSchema = z.object({
  roleId: z.string().uuid(),
});
export const revokeRoleSchema = z.object({
  adminId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export type RevokeRoleDTO = z.infer<typeof revokeRoleSchema>;
export type GetRoleAbilitiesDTO = z.infer<typeof getRoleAbilitiesSchema>;
export type RegisterUserDTO = z.infer<typeof registerUserSchema>;
export type AdminLoginDTO = z.infer<typeof adminLoginSchema>;
export type CreateAdminDTO = z.infer<typeof createAdminSchema>;
export type UpdateAdminDTO = z.infer<typeof updateAdminSchema>;
export type CreateRoleDTO = z.infer<typeof createRoleSchema>;
export type UpdateRoleDTO = z.infer<typeof updateRoleSchema>;
export type AssignRoleDTO = z.infer<typeof assignRoleSchema>;
export type AssignAbilityDTO = z.infer<typeof assignAbilitySchema>;
export type AuditLogsQueryDTO = z.infer<typeof auditLogsQuerySchema>;
export type EnableAdminDTO = z.infer<typeof enableAdminSchema>;
export type DisableAdminDTO = z.infer<typeof disableAdminSchema>;
export type RefreshTokenDTO = z.infer<typeof refreshTokenSchema>;
export type LogoutDTO = z.infer<typeof logoutSchema>;
export type GetAdminDTO = z.infer<typeof getAdminSchema>;
export type ListAdminsDTO = z.infer<typeof listAdminsSchema>;
export type CreateAbilityDTO = z.infer<typeof createAbilitySchema>;
