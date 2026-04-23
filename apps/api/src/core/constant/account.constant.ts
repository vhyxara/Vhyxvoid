export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  RESTRICTED = 'RESTRICTED',
  SUSPENDED = 'SUSPENDED',
  CANCELED = 'CANCELED',
  DELETED = 'DELETED',
}

export enum AccountType {
  PERSONAL = 'PERSONAL',
  ORGANIZATION = 'ORGANIZATION',
}

export enum RoleLevel {
  OWNER = 100,
  ADMIN = 70,
  MEMBER = 10,
}

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  EXPIRED = 'EXPIRED',
  CANCELED = 'CANCELED',
}
