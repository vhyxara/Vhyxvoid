import type { ListApiKeysParams } from '@/api/domain/key-management/types/api-key.types'

export const apiKeyKeys = {
  all: (accountId: string) => ['api-keys', accountId] as const,
  lists: (accountId: string) => ['api-keys', accountId, 'list'] as const,
  list: (accountId: string, params?: ListApiKeysParams) => ['api-keys', accountId, 'list', params] as const,
  detail: (accountId: string, keyId: string) => ['api-keys', accountId, 'detail', keyId] as const,
  usage: (accountId: string, params?: object) => ['api-keys', accountId, 'usage', params] as const
}

export const tunnelKeys = {
  all: (accountId: string) => ['tunnels', accountId] as const,
  active: (accountId: string) => ['tunnels', accountId, 'active'] as const,
  history: (accountId: string, params?: object) => ['tunnels', accountId, 'history', params] as const,
  requests: (accountId: string, agentId: string, params?: object) =>
    ['tunnels', accountId, 'requests', agentId, params] as const,
  usage: (accountId: string, params?: object) => ['tunnels', accountId, 'usage', params] as const,
  analytics: (accountId: string, params?: object) => ['tunnels', accountId, 'analytics', params] as const,
  summary: (accountId: string) => ['tunnels', accountId, 'summary'] as const
}

export const billingKeys = {
  all: (accountId: string) => ['billing', accountId] as const,
  subscription: (accountId: string) => ['billing', accountId, 'subscription'] as const,
  invoices: (accountId: string) => ['billing', accountId, 'invoices'] as const
}
