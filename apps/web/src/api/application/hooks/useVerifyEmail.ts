import { useRouter } from 'next/navigation'

import { useMutation } from '@tanstack/react-query'

import { authService } from '../../infrastructure/services/auth.service'

export function useVerifyEmail() {
  const router = useRouter()

  return useMutation({
    mutationFn: (token: string) => authService.verifyEmail(token),
    onSuccess: () => router.replace('/auth/login?verified=1')
  })
}
