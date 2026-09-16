import { httpClient } from '@/api/wrapper/http'
import { buildQuery } from '@/utils/utility'
import type { PaginatedResponse } from '@/api/types/pagination'
import type {
  ListApiKeysParams,
  ApiKey,
  CreateApiKeyPayload,
  ApiKeyWithSecret,
  UpdateApiKeyPayload,
  RevokeApiKeyPayload,
  ApiKeyRotateResult,
  UsageAnalyticsResult
} from '@/api/domain/key-management/types/api-key.types'
import { API_KEY_ENDPOINTS } from '../endpoints/account.endpoints'

const u = (template: string, accountId: string, keyId?: string) => {
  console.log('Template before replacement:', template, 'Account ID:', accountId, 'Key ID:', keyId)

  return template.replace(':accountId', accountId).replace(':keyId', keyId ?? '')
}

export const apiKeyService = {
  list: (accountId: string, params?: ListApiKeysParams): Promise<PaginatedResponse<ApiKey, { accountId: string }>> => {
    console.log('Listing API keys for account:', accountId)
    const query = params ? `?${buildQuery(params).toString()}` : ''

    return httpClient({
      url: `${u(API_KEY_ENDPOINTS.LIST, accountId)}${query}`,
      method: 'GET'
    })
  },

  create: (accountId: string, data: CreateApiKeyPayload): Promise<ApiKeyWithSecret> =>
    httpClient({ url: u(API_KEY_ENDPOINTS.CREATE, accountId), method: 'POST', data }),

  get: (accountId: string, keyId: string): Promise<ApiKey> =>
    httpClient({ url: u(API_KEY_ENDPOINTS.GET, accountId, keyId), method: 'GET' }),

  update: (accountId: string, keyId: string, data: UpdateApiKeyPayload): Promise<ApiKey> =>
    httpClient({ url: u(API_KEY_ENDPOINTS.UPDATE, accountId, keyId), method: 'PATCH', data }),

  revoke: (accountId: string, keyId: string, data?: RevokeApiKeyPayload): Promise<void> =>
    httpClient({ url: u(API_KEY_ENDPOINTS.REVOKE, accountId, keyId), method: 'POST', data: data ?? {} }),

  rotate: (accountId: string, keyId: string): Promise<ApiKeyRotateResult> => {
    console.log('Rotating API key with ID:', keyId, 'for account:', accountId)

    return httpClient({ url: u(API_KEY_ENDPOINTS.ROTATE, accountId, keyId), method: 'POST', data: {} })
  },

  getUsage: (
    accountId: string,
    params?: { keyId?: string; from?: string; to?: string }
  ): Promise<UsageAnalyticsResult> => {
    const query = params ? `?${buildQuery(params).toString()}` : ''

    return httpClient({ url: `${u(API_KEY_ENDPOINTS.USAGE, accountId)}${query}`, method: 'GET' })
  }
}
