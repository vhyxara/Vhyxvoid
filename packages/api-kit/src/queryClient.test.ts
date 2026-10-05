import { describe, expect, it, vi } from 'vitest'

import { ApiError } from './errors'
import { createQueryClient, errorMessage, shouldRetry } from './queryClient'

describe('shouldRetry', () => {
  it('never retries client errors except 408/429, retries others up to the max', () => {
    expect(shouldRetry(0, new ApiError(404, 'x'))).toBe(false)
    expect(shouldRetry(0, new ApiError(401, 'x'))).toBe(false)
    expect(shouldRetry(0, new ApiError(429, 'x'))).toBe(true)
    expect(shouldRetry(1, new ApiError(500, 'x'))).toBe(true)
    expect(shouldRetry(2, new ApiError(500, 'x'))).toBe(false)
  })
})

describe('createQueryClient', () => {
  it('notifies once for a failed query unless skipped or silent', async () => {
    const onNotify = vi.fn()
    const qc = createQueryClient({ onNotify, skipNotify: e => e instanceof ApiError && e.status === 401 })

    await qc.fetchQuery({ queryKey: ['a'], queryFn: () => Promise.reject(new ApiError(400, 'Bad input')), retry: false }).catch(() => {})
    await qc.fetchQuery({ queryKey: ['b'], queryFn: () => Promise.reject(new ApiError(401, 'x')), retry: false }).catch(() => {})
    await qc
      .fetchQuery({ queryKey: ['c'], queryFn: () => Promise.reject(new ApiError(500, 'x')), retry: false, meta: { silent: true } })
      .catch(() => {})
    expect(onNotify).toHaveBeenCalledTimes(1)
    expect(onNotify.mock.calls[0][0]).toBe('Bad input')
  })

  it('skips the global toast for mutations with their own onError', async () => {
    const onNotify = vi.fn()
    const qc = createQueryClient({ onNotify })
    const fail = () => Promise.reject(new ApiError(409, 'Taken'))

    await qc.getMutationCache().build(qc, { mutationFn: fail, onError: () => {} }).execute(undefined).catch(() => {})
    expect(onNotify).not.toHaveBeenCalled()
    await qc.getMutationCache().build(qc, { mutationFn: fail }).execute(undefined).catch(() => {})
    expect(onNotify).toHaveBeenCalledWith('Taken', expect.any(ApiError))
  })

  it('errorMessage falls back for unknown values', () => {
    expect(errorMessage('x')).toMatch(/Something went wrong/)
  })
})
