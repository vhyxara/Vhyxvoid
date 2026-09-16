import { useRouter } from 'next/navigation'

import { useMutation } from '@tanstack/react-query'

import { authService } from '../../infrastructure/services/auth.service'
import type { RegisterDTO } from '../../infrastructure/services/auth.service'

export function useRegister() {
  const router = useRouter()

  return useMutation({
    mutationFn: (data: RegisterDTO) => authService.register(data),

    onSuccess: () => {
      // Backend returns { message: 'Registration successful. Please verify your email.' }
      // Redirect to a verify-email holding page
      router.replace('/auth/verify-email-sent')
    }
  })
}
