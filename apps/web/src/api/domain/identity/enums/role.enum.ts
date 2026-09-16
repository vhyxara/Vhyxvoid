// Mirrors backend RoleLevel exactly — same numeric values
export enum RoleLevel {
  OWNER = 100,
  ADMIN = 70,
  MEMBER = 10
}

export enum AccountType {
  PERSONAL = 'PERSONAL',
  ORGANIZATION = 'ORGANIZATION'
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  RESTRICTED = 'RESTRICTED',
  SUSPENDED = 'SUSPENDED',
  CANCELED = 'CANCELED',
  DELETED = 'DELETED'
}

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  EXPIRED = 'EXPIRED',
  CANCELED = 'CANCELED'
}

export function roleLevelName(level: RoleLevel | number): string {
  switch (level) {
    case RoleLevel.OWNER:
      return 'Owner'
    case RoleLevel.ADMIN:
      return 'Admin'
    case RoleLevel.MEMBER:
      return 'Member'
    default:
      return 'Unknown'
  }
}

// Chip color for MUI — maps to your existing Chip usage pattern
export function roleLevelColor(level: RoleLevel | number) {
  switch (level) {
    case RoleLevel.OWNER:
      return 'error' as const
    case RoleLevel.ADMIN:
      return 'warning' as const
    case RoleLevel.MEMBER:
      return 'default' as const
    default:
      return 'default' as const
  }
}
