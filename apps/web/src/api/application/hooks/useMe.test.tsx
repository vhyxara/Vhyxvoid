import type { ReactNode } from 'react'

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useMyAccounts, useMyProfile } from './useMe'
import { useAuthStore } from '@/api/domain/identity/store/auth.store'

/**
 * Regression test for the 2026-09-18 chrome-visual.md finding: ProfileView.tsx's
 * "Organization memberships" always showed "Member of 0 organization(s)"
 * because it read `(profile as any).accounts` off `useMyProfile()`'s result —
 * but `useMyProfile()`'s own `select()` deliberately strips the query down to
 * profile-only fields and never included `accounts` in the first place. Fixed
 * by having ProfileView.tsx read `useMyAccounts()` instead (see decision.md,
 * 2026-09-19, "ProfileView organization count"). These tests cover both
 * halves of that fix directly against the real hooks, not the view: that
 * `useMyProfile()`'s shape genuinely has no `accounts` field, and that
 * `useMyAccounts()` returns the real array from the same underlying response.
 */
vi.mock('@/api/infrastructure/services/org.service', () => ({
  orgService: {
    getMe: vi.fn()
  }
}))

const { orgService } = await import('@/api/infrastructure/services/org.service')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const meResponse = {
  id: 'user_1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'Smith',
  fullName: 'Test Smith',
  isEmailVerified: true,
  accounts: [
    { id: 'm1', accountId: 'acct_1', accountName: 'Test Corp', accountType: 'ORGANIZATION', accountStatus: 'ACTIVE', roleLevel: 3, roleName: 'Owner', joinedAt: '2026-04-14T00:00:00.000Z' },
    { id: 'm2', accountId: 'acct_2', accountName: "Test's Workspace", accountType: 'PERSONAL', accountStatus: 'ACTIVE', roleLevel: 3, roleName: 'Owner', joinedAt: '2026-04-14T00:00:00.000Z' }
  ]
}

describe('useMe.ts — useMyProfile / useMyAccounts', () => {
  beforeEach(() => {
    vi.mocked(orgService.getMe).mockReset()
    useAuthStore.getState().setBootstrapStatus('done')
  })

  it('useMyProfile()\'s selected shape does not carry accounts -- reading it off the profile always falls back to undefined, not the real array', async () => {
    vi.mocked(orgService.getMe).mockResolvedValue(meResponse as any)

    const { result } = renderHook(() => useMyProfile(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toEqual({
      id: 'user_1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'Smith',
      fullName: 'Test Smith',
      isEmailVerified: true
    })
    expect((result.current.data as any)?.accounts).toBeUndefined()
  })

  it('useMyAccounts() returns the real accounts array from the same /account/me response', async () => {
    vi.mocked(orgService.getMe).mockResolvedValue(meResponse as any)

    const { result } = renderHook(() => useMyAccounts(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data?.[0].accountName).toBe('Test Corp')
  })
})
