import { type RoleLevel } from '../enums/role.enum'

export type MyAccount = {
  id: string
  accountId: string
  accountName: string | null
  accountType: string | null
  accountStatus: string | null
  roleLevel: RoleLevel
  roleName: string
  joinedAt: string
}

export type MyAccountsResponse = {
  accounts: MyAccount[]
}

export type CreateOrgPayload = {
  name: string
}

export type CreateOrgResponse = {
  organizationId: string
  name: string
}

// Full /accounts/me response after .data unwrap
export type MeResponse = {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  isEmailVerified: boolean
  accounts: MyAccount[]
}

// /organizations/:accountId response
export type OrgDetail = {
  id: string
  name: string
  type: string
  status: string
  createdAt: string
  viewer: {
    roleLevel: RoleLevel
    roleName: string
    isOwner: boolean
    isAdmin: boolean
  }
  stats: {
    memberCount: number
    activeApiKeys: number
  }
}

export type RenameOrgPayload = { name: string }
export type UpdateProfilePayload = { firstName?: string; lastName?: string }
