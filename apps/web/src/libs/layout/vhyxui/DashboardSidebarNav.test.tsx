import type { ReactNode } from 'react'

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { DashboardSidebarNav } from './DashboardSidebarNav'
import { RoleLevel } from '@/api/domain/identity/enums/role.enum'
import type { MyAccount } from '@/api/domain/identity/types/org.types'

/**
 * Regression coverage for decision.md, 2026-09-21, "Personal accounts get a
 * sidebar entry". Every user gets exactly one PERSONAL account at signup and
 * the sidebar used to list ORGANIZATION accounts only, so a user who never
 * created an organization had no link to API Keys or Tunnels.
 */

const useMyAccounts = vi.fn()

vi.mock('@/api/application/hooks/useMe', () => ({ useMyAccounts: () => useMyAccounts() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))

// The linked @vhyxui/react resolves its own React copy under vitest, so its Badge throws "Invalid hook call";
// the badge itself is not what is under test.
vi.mock('@vhyxui/react', () => ({ Badge: ({ children }: { children: ReactNode }) => <span>{children}</span> }))

function account(over: Partial<MyAccount>): MyAccount {
  return {
    id: 'm1',
    accountId: 'acc-1',
    accountName: 'Solo Workspace',
    accountType: 'PERSONAL',
    accountStatus: 'ACTIVE',
    roleLevel: RoleLevel.OWNER,
    roleName: 'OWNER',
    joinedAt: '2026-09-21T00:00:00.000Z',
    ...over
  }
}

const hrefs = () => screen.queryAllByRole('link').map(a => a.getAttribute('href'))

describe('DashboardSidebarNav', () => {
  beforeEach(() => useMyAccounts.mockReset())
  afterEach(cleanup)

  it('gives a personal-only user links to API Keys and Tunnels, and nothing that does not apply to a personal account', () => {
    useMyAccounts.mockReturnValue({ data: [account({})], isLoading: false })
    render(<DashboardSidebarNav showLabels />)

    expect(screen.getByText('Personal workspace')).toBeTruthy()
    expect(screen.getByText('Solo Workspace')).toBeTruthy()
    expect(hrefs()).toContain('/organizations/acc-1/api-keys')
    expect(hrefs()).toContain('/organizations/acc-1/tunnels')
    expect(hrefs()).not.toContain('/organizations/acc-1/members')
    expect(hrefs()).not.toContain('/organizations/acc-1/billing')
    expect(hrefs()).not.toContain('/organizations/acc-1/settings')

    // still offered the way to get an organization
    expect(screen.getByText('Create organization')).toBeTruthy()
  })

  it('keeps the full organization sub-nav for an organization, alongside the personal one', () => {
    useMyAccounts.mockReturnValue({
      data: [account({}), account({ accountId: 'org-1', accountName: 'Acme', accountType: 'ORGANIZATION' })],
      isLoading: false
    })
    render(<DashboardSidebarNav showLabels />)

    for (const page of ['members', 'api-keys', 'tunnels', 'billing', 'settings']) {
      expect(hrefs()).toContain(`/organizations/org-1/${page}`)
    }

    expect(hrefs()).toContain('/organizations/acc-1/api-keys')
    expect(screen.queryByText('Create organization')).toBeNull()
  })

  it('shows no personal section when the user has no personal account', () => {
    useMyAccounts.mockReturnValue({
      data: [account({ accountId: 'org-1', accountName: 'Acme', accountType: 'ORGANIZATION' })],
      isLoading: false
    })
    render(<DashboardSidebarNav showLabels />)

    expect(screen.queryByText('Personal workspace')).toBeNull()
  })
})
