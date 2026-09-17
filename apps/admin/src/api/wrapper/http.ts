import { createHttpClient } from '@vhyx/api-kit'
import type { HttpMethod, HttpRequestConfig } from '@vhyx/api-kit'

export type { HttpMethod, HttpRequestConfig }

// Wires @vhyx/api-kit's transport scaffold to apps/admin's OWN auth model --
// deliberately not a copy of apps/web's http.ts. The two differ in exactly
// the way internal-tools/admin-frontend/decision.md's Part 3.3 predicted:
// admin login/refresh return both tokens in the JSON body with zero cookie
// involvement, so (a) getAuthHeaders reads the access token from
// auth.store.ts (same idea as apps/web) but (b) the refresh call itself
// must carry the stored refresh token explicitly, and (c) a successful
// refresh must persist the NEW refresh token too, not just the new access
// token, per the token-rotation/reuse-detection behavior confirmed by
// reading AdminRefreshToken.usecase.ts directly (see auth.types.ts).
//
// This is also this session's real confirmation of
// internal-tools/admin-frontend/decision.md's open question: whether
// @vhyx/api-kit's getAuthHeaders/onUnauthorized injection surface actually
// fits a second, differently-shaped auth model cleanly. It does -- nothing
// here needed to reach past what the package already exposes.

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
    const { getAdminRefreshToken } = await import('@/api/domain/auth/auth.store')
    const currentRefreshToken = getAdminRefreshToken()

    if (!currentRefreshToken) {
      throw new Error('No refresh token available')
    }

    // Lazy import -- adminAuthService uses httpClient, which would be
    // circular if imported at module top level here.
    const { adminAuthService } = await import('@/api/infrastructure/auth.service')
    const tokens = await adminAuthService.refresh(currentRefreshToken)

    const { useAdminAuthStore } = await import('@/api/domain/auth/auth.store')

    useAdminAuthStore.getState().setTokens(tokens)
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
