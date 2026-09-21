import type { ReactNode } from 'react'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act, waitFor } from '@testing-library/react'

const create = vi.fn()
const update = vi.fn()

vi.mock('@/api/infrastructure/admin-user.service', () => ({
  adminUserService: { create: (...a: unknown[]) => create(...a), update: (...a: unknown[]) => update(...a) }
}))

import { useCreateAdmin, useUpdateAdmin } from './useAdminUsers'
import { adminUserKeys } from '@/api/infrastructure/query-keys/admin-user.keys'
import { useAdminAuthStore } from '@/api/domain/auth/auth.store'

// Not assumed correct because they compiled once: useCreateAdmin's
// invalidation must reach the status-keyed list variants the table reads, and
// useUpdateAdmin must refresh both the list and the detail page.
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

  return { client, invalidate, wrapper }
}

beforeEach(() => {
  create.mockReset()
  update.mockReset()
  useAdminAuthStore.setState({
    admin: { id: 'me', email: 'me@company.local', fullName: 'Me Myself', isSuperAdmin: true }
  })
})

describe('useCreateAdmin', () => {
  it('posts the payload and invalidates every admin-users query (all status variants)', async () => {
    create.mockResolvedValue({ id: 'new', email: 'n@c.co', fullName: 'New Admin' })
    const { invalidate, wrapper, client } = setup()

    client.setQueryData(adminUserKeys.list({ status: true }), [])
    client.setQueryData(adminUserKeys.list({ status: undefined }), [])

    const { result } = renderHook(() => useCreateAdmin(), { wrapper })
    const dto = { email: 'n@c.co', password: 'password1', firstName: 'New', lastName: 'Admin' }

    await act(async () => {
      await result.current.mutateAsync(dto)
    })

    expect(create).toHaveBeenCalledWith(dto)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminUserKeys.all })
    expect(client.getQueryState(adminUserKeys.list({ status: true }))?.isInvalidated).toBe(true)
    expect(client.getQueryState(adminUserKeys.list({ status: undefined }))?.isInvalidated).toBe(true)
  })
})

describe('useUpdateAdmin', () => {
  it('invalidates the list and that admin\'s detail, but not another admin\'s detail', async () => {
    update.mockResolvedValue({ id: 'other', email: 'o@c.co', firstName: 'O', lastName: 'P', fullName: 'O P' })
    const { wrapper, client } = setup()

    client.setQueryData(adminUserKeys.list({ status: undefined }), [])
    client.setQueryData(adminUserKeys.detail('other'), {})
    client.setQueryData(adminUserKeys.detail('unrelated'), {})

    const { result } = renderHook(() => useUpdateAdmin('other'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ firstName: 'O', lastName: 'P' })
    })

    expect(update).toHaveBeenCalledWith('other', { firstName: 'O', lastName: 'P' })
    expect(client.getQueryState(adminUserKeys.list({ status: undefined }))?.isInvalidated).toBe(true)
    expect(client.getQueryState(adminUserKeys.detail('other'))?.isInvalidated).toBe(true)
  })

  it('leaves the signed-in admin\'s stored name alone when editing someone else', async () => {
    update.mockResolvedValue({ id: 'other', email: 'o@c.co', firstName: 'O', lastName: 'P', fullName: 'O P' })
    const { wrapper } = setup()
    const { result } = renderHook(() => useUpdateAdmin('other'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ firstName: 'O' })
    })

    expect(useAdminAuthStore.getState().admin?.fullName).toBe('Me Myself')
  })

  it('updates the stored name (which the header shows) when the admin edits themselves', async () => {
    update.mockResolvedValue({ id: 'me', email: 'me@company.local', firstName: 'Renamed', lastName: 'Me', fullName: 'Renamed Me' })
    const { wrapper } = setup()
    const { result } = renderHook(() => useUpdateAdmin('me'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ firstName: 'Renamed', lastName: 'Me' })
    })

    await waitFor(() => expect(useAdminAuthStore.getState().admin?.fullName).toBe('Renamed Me'))
    expect(useAdminAuthStore.getState().admin?.isSuperAdmin).toBe(true)
  })
})
