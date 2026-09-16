import { useRouter } from 'next/navigation'

import { useQueryClient, useMutation } from '@tanstack/react-query'

// import { authService } from '@/api/services/auth.service'
import { useAuthStore } from '@/api/domain/identity/store/auth.store'
import { authService } from '@/api/infrastructure/services/auth.service'

export function useLogout() {
  const { clearSession } = useAuthStore()
  const queryClient = useQueryClient()
  const router = useRouter()

  const clearSessionCookie = () => {
    document.cookie = 'is_authenticated=; path=/; max-age=0; SameSite=Strict'
  }

  const handleLogout = () => {
    clearSessionCookie()
    clearSession()
    queryClient.clear()
    router.replace('/login')
  }

  return useMutation({
    // Server revokes the session via the httpOnly cookie — no token in body
    mutationFn: () => authService.logout(),
    onSuccess: handleLogout,

    // Logout is always idempotent — clear client state even if server call fails
    onError: handleLogout
  })
}
