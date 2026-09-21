import { beforeEach, describe, expect, it, vi } from 'vitest'

const httpClient = vi.fn()

vi.mock('@/api/wrapper/http', () => ({ httpClient: (...args: unknown[]) => httpClient(...args) }))

import { adminUserService } from './admin-user.service'

describe('adminUserService create/update wiring', () => {
  beforeEach(() => httpClient.mockReset().mockResolvedValue({}))

  it('create -> POST /admin/identity/users with the body as given', async () => {
    const data = { email: 'a@b.co', password: 'password1', firstName: 'A', lastName: 'B' }

    await adminUserService.create(data)

    expect(httpClient).toHaveBeenCalledWith({ url: '/admin/identity/users', method: 'POST', data })
  })

  it('update -> PUT /admin/identity/users/:id (not PATCH, not /me) with name fields only', async () => {
    await adminUserService.update('abc', { firstName: 'Conrad', lastName: 'Tracton' })

    expect(httpClient).toHaveBeenCalledWith({
      url: '/admin/identity/users/abc',
      method: 'PUT',
      data: { firstName: 'Conrad', lastName: 'Tracton' }
    })
  })
})
