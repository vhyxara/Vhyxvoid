import type { PaginatedResponse } from '@/api/types/pagination'
import type { RoleLevel } from '../enums/role.enum'

// Nested role object — matches backend response exactly
export type MemberRole = {
  id: string
  name: string
  level: RoleLevel
  levelName: string
  description: string | null
}
export type RemoveMemberPayload = {
  accountId: string
  targetUserId: string
}

// ── Core shapes — match backend response exactly ───────────────────────────

export type MemberUser = {
  email: string
  firstName: string
  lastName: string
  fullName: string
  isEmailVerified: boolean
}

/**
 * Single member row from GET /account/organizations/:accountId/members
 * Backend returns both flat fields (email, firstName…) AND a nested user object.
 * We use the nested `user` object for display — it's always present for active members.
 *
 * NOTE: `id` is aliased to `userId` so GenericServerTable's getRowId works.
 */
export type Member = {
  userId: string
  id: string // alias — set to userId in service layer so table getRowId works
  role: {
    id: string
    name: string
    level: RoleLevel
    levelName: string
    description: string
  }
  roleName: string
  joinedAt: string
  isYou: boolean
  canManage: boolean // computed server-side per row
  user: MemberUser | null
}

export type MembersExtra = {
  accountId: string
}

export type MembersListResponse = PaginatedResponse<Member, MembersExtra>

// ── Mutation payloads ──────────────────────────────────────────────────────

export type InviteMemberPayload = {
  email: string
  roleLevel: RoleLevel
}

export type InviteMemberResponse = {
  invitationId: string
  inviteToken: string
}

export type ChangeMemberRolePayload = {
  newRoleLevel: RoleLevel
}

export type TransferOwnershipPayload = {
  targetUserId: string
}

export type AcceptInvitationPayload = {
  token: string
}

export type AcceptInvitationResponse = {
  accountId: string
  roleLevel: RoleLevel
}

// ── Invitation shapes ──────────────────────────────────────────────────────

export type Invitation = {
  id: string
  email: string
  roleLevel: RoleLevel
  roleName: string
  status: string
  expiresAt: string
  createdAt: string
  invitedBy: {
    userId: string
    fullName: string | null
    email: string | null
  }
}

export type InvitationsListResponse = {
  accountId: string
  status: string
  totalCount: number
  invitations: Invitation[]
}

// Keep existing Member type exactly as is, add these helpers at the bottom:

/** Flat display helpers — read from nested user object */
export function getMemberName(m: Member): string {
  return m.user?.fullName ?? m.userId
}

export function getMemberEmail(m: Member): string {
  return m.user?.email ?? ''
}

export function getMemberInitials(m: Member): string {
  const u = m.user

  if (u?.firstName && u?.lastName) {
    return `${u.firstName[0]}${u.lastName[0]}`.toUpperCase()
  }

  return (u?.email?.[0] ?? m.userId[0]).toUpperCase()
}
