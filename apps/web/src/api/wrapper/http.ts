import { createHttpClient } from '@vhyx/api-kit'
import type { HttpMethod, HttpRequestConfig } from '@vhyx/api-kit'

export type { HttpMethod, HttpRequestConfig }

// The transport mechanics (signing/envelope/error-typing scaffold) now live
// in the shared @vhyx/api-kit package -- see TABLE_API_ARCHITECTURE_COMPARISON.md
// and decision.md, 2026-09-15. This file only wires VhyxVoid's own,
// project-specific auth model into it: where the current access token
// comes from, and what to do when a request comes back unauthorized.

// ── Refresh queue ─────────────────────────────────────────────────────────
// Holds requests that arrived during an in-flight refresh. Once refresh
// completes they all retry (each re-reading the now-updated token via
// getAuthHeaders), rather than each triggering its own independent
// refresh call.

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

// ── Helpers ───────────────────────────────────────────────────────────────

function clearSessionCookie() {
  if (typeof document !== 'undefined') {
    document.cookie = 'is_authenticated=; path=/; max-age=0; SameSite=Strict'
  }
}

async function hardLogout() {
  const { clearSession } = await import('@/api/domain/identity/store/auth.store')

  clearSession()
  clearSessionCookie()
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
    // Lazy import — authService uses httpClient which would be circular if imported at top
    const { authService } = await import('@/api/infrastructure/services/auth.service')
    const tokens = await authService.refresh()

    const { useAuthStore } = await import('@/api/domain/identity/store/auth.store')

    useAuthStore.getState().setTokens(tokens)
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

/**
 * Single unified HTTP client.
 *
 * Always sends credentials (cookies) — required for the httpOnly refresh
 * token. Unwraps { success, message, data } envelope → returns data
 * directly. Throws ApiError on non-2xx responses. On a 401, transparently
 * refreshes (queueing concurrent 401s behind one refresh call) and retries
 * once; hard-logs-out only if the refresh itself fails.
 */
export const httpClient = createHttpClient({
  baseUrl: () => process.env.NEXT_PUBLIC_API_URL_LIVE ?? '',

  getAuthHeaders: async () => {
    // Lazy import avoids circular dependency and Next.js dual-instance issues.
    // auth.store must never be imported at module level in http.ts.
    const { getAccessToken } = await import('@/api/domain/identity/store/auth.store')
    const accessToken = getAccessToken()

    return accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
  },

  onUnauthorized: handleUnauthorized
})
