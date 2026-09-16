import { httpClient } from '@/api/wrapper/http'

import type {
  MembersListResponse,
  InviteMemberPayload,
  InviteMemberResponse,
  ChangeMemberRolePayload,
  TransferOwnershipPayload,
  AcceptInvitationPayload,
  AcceptInvitationResponse,
  InvitationsListResponse
} from '@/api/domain/identity/types/member.types'

import { ACCOUNT_ENDPOINTS } from '../endpoints/account.endpoints'
import { buildQuery, withId } from '@/utils/utility'

// import { type MyAccountsResponse } from '@/domain/identity/types/org.types'
import { type FetchParams } from '@/libs/table/GenericServerTable'

// ── URL builder helpers specific to this module ────────────────────────────

// function membersUrl(accountId: string) {
//   return withId(ACCOUNT_ENDPOINTS.ORG_MEMBERS, accountId).replace(':accountId', accountId)
// }

function memberUrl(accountId: string, userId: string) {
  return withId(ACCOUNT_ENDPOINTS.REMOVE_MEMBER, accountId).replace(':accountId', accountId).replace(':userId', userId)
}

function inviteUrl(accountId: string) {
  return withId(ACCOUNT_ENDPOINTS.INVITE_MEMBER, accountId).replace(':accountId', accountId)
}

function changeRoleUrl(accountId: string, userId: string) {
  return withId(ACCOUNT_ENDPOINTS.CHANGE_ROLE, accountId).replace(':accountId', accountId).replace(':userId', userId)
}

function transferUrl(accountId: string) {
  return withId(ACCOUNT_ENDPOINTS.TRANSFER_OWNERSHIP, accountId).replace(':accountId', accountId)
}

const url = (template: string, accountId: string, userId?: string) =>
  template.replace(':accountId', accountId).replace(':userId', userId ?? '')

// ── Service ────────────────────────────────────────────────────────────────

export const memberService = {
  /**
   * GET /accounts/organizations/:accountId/members
   * Returns a standard paginated response — items/meta/extra at top level.
   */

  /**
   * GET /account/organizations/:accountId/members
   * Normalises response: adds `id = userId` so GenericServerTable's
   * getRowId (which uses `row.id`) works without modification.
   */
  getMembers: async (accountId: string, params?: Partial<FetchParams>): Promise<MembersListResponse> => {
    const query = params ? `?${buildQuery(params).toString()}` : ''

    const res = await httpClient<MembersListResponse>({
      url: `${url(ACCOUNT_ENDPOINTS.ORG_MEMBERS, accountId)}${query}`,
      method: 'GET'
    })

    // apps/api's GetAccountMembersUseCase only returns `id` per member — it
    // never sends a `userId` field (confirmed by reading the use case
    // directly). Every consumer of Member (remove/change-role/transfer
    // dialogs, useRemoveMember's optimistic filter) reads `.userId`, which
    // was `undefined` at runtime before this fix — a wrong-ID-field bug of
    // the same class as Step 5b's rotate bug, just server-shape-driven
    // instead of a wrong param name. See decision.md, 2026-09-11.
    return { ...res, items: res.items.map(item => ({ ...item, userId: item.id })) }
  },

  // GET /organizations/:accountId/members/:userId
  getMember: (accountId: string, userId: string) =>
    httpClient<{ userId: string; roleLevel: number; user: any }>({
      url: memberUrl(accountId, userId),
      method: 'GET'
    }),

  /**
   * POST /accounts/organizations/:accountId/members/invite
   * Response: { success, message, data: { invitationId, inviteToken } }
   * httpClientConfig unwraps .data automatically.
   */
  inviteMember: (accountId: string, data: InviteMemberPayload): Promise<InviteMemberResponse> =>
    httpClient<InviteMemberResponse>({
      url: inviteUrl(accountId),
      method: 'POST',
      data
    }),

  /**
   * PATCH /accounts/organizations/:accountId/members/:userId/role
   */
  changeMemberRole: (accountId: string, userId: string, data: ChangeMemberRolePayload) =>
    httpClient<{ success: boolean }>({
      url: changeRoleUrl(accountId, userId),
      method: 'PATCH',
      data
    }),

  /**
   * DELETE /accounts/organizations/:accountId/members/:userId
   */
  removeMember: (accountId: string, targetUserId: string) =>
    httpClient<{ success: boolean }>({
      url: memberUrl(accountId, targetUserId),
      method: 'DELETE'
    }),

  /**
   * POST /accounts/organizations/:accountId/transfer-ownership
   */
  transferOwnership: (accountId: string, data: TransferOwnershipPayload) =>
    httpClient<{ success: boolean }>({
      url: transferUrl(accountId),
      method: 'POST',
      data
    }),

  /**
   * POST /accounts/invitations/accept
   * Response: { success, message, data: { accountId, roleLevel } }
   */
  acceptInvitation: (data: AcceptInvitationPayload): Promise<AcceptInvitationResponse> =>
    httpClient<AcceptInvitationResponse>({
      url: ACCOUNT_ENDPOINTS.ACCEPT_INVITATION,
      method: 'POST',
      data
    }),

  // GET /organizations/:accountId/invitations
  getInvitations: (accountId: string, status = 'PENDING') =>
    httpClient<InvitationsListResponse>({
      url: ACCOUNT_ENDPOINTS.INVITATIONS.replace(':accountId', accountId) + `?status=${status}`,
      method: 'GET'
    }),

  // DELETE /organizations/:accountId/invitations/:invitationId
  cancelInvitation: (accountId: string, invitationId: string) =>
    httpClient<null>({
      url: ACCOUNT_ENDPOINTS.CANCEL_INVITATION.replace(':accountId', accountId).replace(':invitationId', invitationId),
      method: 'DELETE'
    })
}
