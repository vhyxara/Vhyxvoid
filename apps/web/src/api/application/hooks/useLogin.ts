import { useMutation } from '@tanstack/react-query'

import { useAuthStore } from '@/api/domain/identity/store/auth.store'

import { authService, type LoginDTO } from '@/api/infrastructure/services/auth.service'
import { useRouter } from '@/i18n/navigation'

export function useLogin() {
  const { setTokens } = useAuthStore()
  const router = useRouter()

  return useMutation({
    mutationFn: (data: LoginDTO) => authService.login(data),

    onSuccess: res => {
      // accessToken → Zustand memory
      // refreshToken → httpOnly cookie (set by server, browser manages it)
      // user → Zustand + sessionStorage (via persist)
      setTokens(res)

      // Lightweight JS-readable flag so bootstrap knows a session exists
      const maxAge = 60 * 60 * 24 * 30 // 30 days — match refresh token TTL

      document.cookie = `is_authenticated=1; path=/; max-age=${maxAge}; SameSite=Strict`

      router.replace('/dashboard')
    }

    // Errors handled globally by MutationCache.onError → toast
  })
}
