export const ACCOUNT_ENDPOINTS = {
  MY_ACCOUNTS: '/account/me',
  CREATE_ORG: '/account/organizations',
  ORG_MEMBERS: '/account/organizations/:accountId/members',
  INVITE_MEMBER: '/account/organizations/:accountId/members/invite',
  CHANGE_ROLE: '/account/organizations/:accountId/members/:userId/role',
  REMOVE_MEMBER: '/account/organizations/:accountId/members/:userId',
  TRANSFER_OWNERSHIP: '/account/organizations/:accountId/transfer-ownership',
  ACCEPT_INVITATION: '/account/invitations/accept',
  CANCEL_INVITATION: '/account/organizations/:accountId/invitations/:invitationId',
  INVITATIONS: '/account/organizations/:accountId/invitations',
  RENAME_ORG: '/account/organizations/:accountId',
  GET_ORG_DETAIL: '/account/organizations/:accountId'
} as const

export const API_KEY_ENDPOINTS = {
  LIST: '/apikeys/organizations/:accountId/api-keys',
  CREATE: '/apikeys/organizations/:accountId/api-keys',
  GET: '/apikeys/organizations/:accountId/api-keys/:keyId',
  UPDATE: '/apikeys/organizations/:accountId/api-keys/:keyId',
  REVOKE: '/apikeys/organizations/:accountId/api-keys/:keyId/revoke',
  ROTATE: '/apikeys/organizations/:accountId/api-keys/:keyId/rotate',
  USAGE: '/apikeys/organizations/:accountId/api-keys/usage'
} as const

export const TUNNEL_ENDPOINTS = {
  ACTIVE: '/tunnel/organizations/:accountId/tunnels',
  HISTORY: '/tunnel/organizations/:accountId/tunnels/history',
  REQUESTS: '/tunnel/organizations/:accountId/tunnels/:agentId/requests',
  USAGE: '/tunnel/organizations/:accountId/tunnels/usage',
  USAGE_SUMMARY: '/tunnel/organizations/:accountId/usage/summary',
  ANALYTICS: '/tunnel/organizations/:accountId/usage'
} as const

export const BILLING_ENDPOINTS = {
  CHECKOUT: '/billing/organizations/:accountId/billing/checkout',
  PORTAL: '/billing/organizations/:accountId/billing/portal',
  SUBSCRIPTION: '/billing/organizations/:accountId/billing/subscription',
  INVOICES: '/billing/organizations/:accountId/billing/invoices'
} as const
