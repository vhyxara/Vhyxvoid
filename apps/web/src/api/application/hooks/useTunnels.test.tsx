import type { ReactNode } from 'react'

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useTunnelHistoryTableList } from './useTunnels'
import { useAuthStore } from '@/api/domain/identity/store/auth.store'

/**
 * Tunnels (Phase 2, fourth table — see decision.md, 2026-09-16, "Phase 2:
 * Tunnels converted") has zero mutations anywhere (confirmed by grep), so
 * unlike Members/API Keys/Invitations there's no disjoint-query-key
 * staleness bug to prove and no point-fix to remove. The one genuinely new
 * piece of logic this conversion adds is `useTunnelHistoryTableList`'s
 * `id`-substitution: the backend's history endpoint response omits `id`
 * entirely even though `TunnelSession`'s own type declares it required
 * (see the hook's own doc comment / decision.md, 2026-09-10, "Step 5a") —
 * GenericServerTable needs a real id for row keys, so this hook derives one
 * from `agentId`. That's the one thing worth a regression test here.
 */
vi.mock('@/api/infrastructure/services/tunnel.service', () => ({
  tunnelService: {
    getHistory: vi.fn()
  }
}))

const { tunnelService } = await import('@/api/infrastructure/services/tunnel.service')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useTunnelHistoryTableList', () => {
  beforeEach(() => {
    vi.mocked(tunnelService.getHistory).mockReset()
    useAuthStore.getState().setBootstrapStatus('done')
  })

  it('derives a row id from agentId when the backend response omits id', async () => {
    vi.mocked(tunnelService.getHistory).mockResolvedValue({
      success: true,
      message: 'ok',
      items: [
        {
          agentId: 'agt_123',
          label: 'my-agent',
          status: 'DISCONNECTED',
          connectedAt: '2026-09-01T00:00:00.000Z',
          disconnectedAt: '2026-09-01T01:00:00.000Z',
          durationMs: 3_600_000,
          apiKey: null
        } as any
      ],
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      extra: { accountId: 'acct_1' }
    })

    const { result } = renderHook(() => useTunnelHistoryTableList('acct_1', { page: 1, limit: 10 }), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data?.items[0].id).toBe('agt_123')
  })

  it('maps FetchParams filters.status into the backend\'s flat status param', async () => {
    vi.mocked(tunnelService.getHistory).mockResolvedValue({
      success: true,
      message: 'ok',
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 1 },
      extra: { accountId: 'acct_1' }
    })

    renderHook(
      () =>
        useTunnelHistoryTableList('acct_1', {
          page: 1,
          limit: 10,
          filters: { status: 'CONNECTED' }
        }),
      { wrapper }
    )

    await waitFor(() => expect(tunnelService.getHistory).toHaveBeenCalled())

    expect(tunnelService.getHistory).toHaveBeenCalledWith(
      'acct_1',
      expect.objectContaining({ status: 'CONNECTED', page: 1, limit: 10 })
    )
  })
})
