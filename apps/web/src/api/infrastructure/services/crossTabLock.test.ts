import { describe, it, expect, vi, afterEach } from 'vitest'

// Covers audit H10's frontend half. A real multi-tab browser run isn't
// possible in this suite, so navigator.locks is replaced by a stand-in with
// the Web Locks API's exclusive semantics (one holder per name, FIFO), shared
// by every "tab" exactly as the browser shares it across same-origin tabs.
function installLocks() {
  const queues = new Map<string, Promise<unknown>>()
  const request = vi.fn((name: string, _opts: unknown, fn: () => Promise<unknown>) => {
    const prev = queues.get(name) ?? Promise.resolve()
    const run = prev.then(() => fn())
    queues.set(name, run.catch(() => {}))
    return run
  })
  vi.stubGlobal('navigator', { locks: { request } })
  return request
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.doUnmock('@/api/wrapper/http')
})

async function loadAuthServiceWithFakeServer() {
  const log: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  vi.doMock('@/api/wrapper/http', () => ({
    httpClient: vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      log.push('start')
      await new Promise(r => setTimeout(r, 10))
      log.push('end')
      inFlight--
      return { accessToken: 'a', refreshToken: 'r', expiresIn: 900 }
    })
  }))
  const { authService } = await import('./auth.service')
  return { authService, log, max: () => maxInFlight }
}

describe('refresh is serialized across tabs (H10)', () => {
  it('two tabs refreshing at the same moment never have two refresh requests in flight', async () => {
    const request = installLocks()
    const { authService, log, max } = await loadAuthServiceWithFakeServer()

    // Two "tabs" call refresh concurrently (bootstrap in one, a 401 in another).
    await Promise.all([authService.refresh(), authService.refresh()])

    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0][0]).toBe('vhyxvoid:auth-refresh')
    expect(max()).toBe(1)
    expect(log).toEqual(['start', 'end', 'start', 'end'])
  })

  it('still refreshes where the Web Locks API is missing', async () => {
    vi.stubGlobal('navigator', {})
    const { authService } = await loadAuthServiceWithFakeServer()

    await expect(authService.refresh()).resolves.toMatchObject({ accessToken: 'a' })
  })
})
