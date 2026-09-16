// infrastructure/bootstrap/bootstrapSession.ts

import { authService } from '../services/auth.service'
import { useAuthStore } from '@/api/domain/identity/store/auth.store'

let bootstrapCalled = false

function hasSessionCookie(): boolean {
  if (typeof document === 'undefined') return false

  return document.cookie.split(';').some(c => c.trim().startsWith('is_authenticated=1'))
}

function clearSessionCookie() {
  if (typeof document !== 'undefined') {
    document.cookie = 'is_authenticated=; path=/; max-age=0; SameSite=Strict'
  }
}

export async function bootstrapSession(): Promise<void> {
  if (bootstrapCalled) return
  bootstrapCalled = true

  const { setBootstrapStatus, clearSession, setTokens } = useAuthStore.getState()

  setBootstrapStatus('loading')

  try {
    // is_authenticated is a lightweight JS-readable flag cookie (set on login).
    // The actual refresh token travels as a separate httpOnly cookie —
    // the browser sends it automatically on POST /api/v1/auth/refresh.
    if (!hasSessionCookie()) {
      clearSession()

      return
    }

    // No body needed — browser sends httpOnly refresh_token cookie automatically
    const tokens = await authService.refresh()

    // Restore full session: accessToken in memory, user + isAuthenticated in Zustand
    setTokens(tokens)
  } catch {
    // refresh_token expired or revoked on server
    clearSession()
    clearSessionCookie()
  } finally {
    setBootstrapStatus('done')
  }
}
