import { createHttpClient } from '@vhyxvoid/api-kit'
import type { HttpMethod, HttpRequestConfig } from '@vhyxvoid/api-kit'

export type { HttpMethod, HttpRequestConfig }

// Wires @vhyxvoid/api-kit to apps/admin's auth model: the access token is
// in memory (auth.store.ts), the refresh token is an httpOnly cookie the
// browser sends to /admin/identity/auth/refresh. A 401 triggers one refresh
// (concurrent 401s wait for it) and a retry; a failed refresh signs out.

type QueueItem = {
  resolve: () => void
  reject: (err: unknown) => void
}

let isRefreshing = false
let failedQueue: QueueItem[] = []

function processQueue(error: unknown) {
  failedQueue.forEach(item => (error ? item.reject(error) : item.resolve()))
  failedQueue = []
}

async function hardLogout() {
  const { clearAdminSession } = await import('@/api/domain/auth/auth.store')

  clearAdminSession()
  if (typeof window !== 'undefined') window.location.replace('/login')
}

async function handleUnauthorized<T>(retry: () => Promise<T>): Promise<T> {
  if (isRefreshing) {
    await new Promise<void>((resolve, reject) => {
      failedQueue.push({ resolve, reject })
    })

    return retry()
  }

  isRefreshing = true

  try {
    // Lazy import -- adminAuthService uses httpClient, which would be
    // circular if imported at module top level here.
    const { adminAuthService } = await import('@/api/infrastructure/auth.service')
    const tokens = await adminAuthService.refresh()

    const { useAdminAuthStore } = await import('@/api/domain/auth/auth.store')

    useAdminAuthStore.getState().setAccessToken(tokens.accessToken)
    processQueue(null)

    return await retry()
  } catch (refreshErr) {
    processQueue(refreshErr)
    await hardLogout()
    throw refreshErr
  } finally {
    isRefreshing = false
  }
}

export const httpClient = createHttpClient({
  baseUrl: () => process.env.NEXT_PUBLIC_ADMIN_API_URL ?? 'http://localhost:9000/api/v1',

  getAuthHeaders: async () => {
    // Lazy import avoids a circular dependency at module load time.
    const { getAdminAccessToken } = await import('@/api/domain/auth/auth.store')
    const accessToken = getAdminAccessToken()

    return accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
  },

  onUnauthorized: handleUnauthorized
})
