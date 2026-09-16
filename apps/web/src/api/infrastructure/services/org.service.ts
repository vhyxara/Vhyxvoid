import { httpClient } from '@/api/wrapper/http'
import type {
  CreateOrgPayload,
  CreateOrgResponse,
  MeResponse,
  MyAccountsResponse,
  OrgDetail,
  RenameOrgPayload,
  UpdateProfilePayload
} from '@/api/domain/identity/types/org.types'

import { ACCOUNT_ENDPOINTS } from '../endpoints/account.endpoints'

export const orgService = {
  getMyAccounts: () =>
    httpClient<MyAccountsResponse>({
      url: ACCOUNT_ENDPOINTS.MY_ACCOUNTS,
      method: 'GET'
    }),

  createOrg: (data: CreateOrgPayload) =>
    httpClient<CreateOrgResponse>({
      url: ACCOUNT_ENDPOINTS.CREATE_ORG,
      method: 'POST',
      data
    }),

  // GET /accounts/me — full profile + accounts
  getMe: () =>
    httpClient<MeResponse>({
      url: ACCOUNT_ENDPOINTS.MY_ACCOUNTS,
      method: 'GET'
    }),

  // PATCH /accounts/me
  updateProfile: (data: UpdateProfilePayload) =>
    httpClient<{ id: string; email: string; firstName: string; lastName: string; fullName: string }>({
      url: ACCOUNT_ENDPOINTS.MY_ACCOUNTS,
      method: 'PATCH',
      data
    }),

  // GET /accounts/organizations/:accountId
  getOrgDetail: (accountId: string) =>
    httpClient<OrgDetail>({
      url: ACCOUNT_ENDPOINTS.GET_ORG_DETAIL.replace(':accountId', accountId),
      method: 'GET'
    }),

  // PATCH /accounts/organizations/:accountId
  renameOrg: (accountId: string, data: RenameOrgPayload) =>
    httpClient<{ id: string; name: string }>({
      url: ACCOUNT_ENDPOINTS.RENAME_ORG.replace(':accountId', accountId),
      method: 'PATCH',
      data
    })
}
