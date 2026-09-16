import { useMutation, useQueryClient } from '@tanstack/react-query'

import toast from 'react-hot-toast'

import { useAuthStore } from '@/api/domain/identity/store/auth.store'
import type {
  ForgotPasswordPayload,
  ResetPasswordPayload,
  ChangePasswordPayload
} from '@/api/domain/identity/types/auth.types'
import { passwordService } from '@/api/infrastructure/services/password.service'
import { useRouter } from '@/i18n/navigation'

/**
 * Step 1 — request reset link.
 * Always succeeds visually (backend returns 200 regardless of email existence).
 * Show a generic success message — never confirm whether email exists.
 */
export function useForgotPassword() {
  return useMutation({
    mutationFn: (data: ForgotPasswordPayload) => passwordService.forgotPassword(data)
  })
}

/**
 * Step 2 — submit new password with token from email link.
 * On success redirect to login — all sessions were revoked server-side.
 */
export function useResetPassword() {
  const router = useRouter()

  return useMutation({
    mutationFn: (data: ResetPasswordPayload) => passwordService.resetPassword(data),
    onSuccess: () => {
      toast.success('Password reset successfully. Please log in.')
      router.replace('/login')
    }
  })
}

/**
 * Change password for authenticated user.
 * Server revokes ALL sessions after change.
 * Client clears local session and redirects to login.
 */
export function useChangePassword() {
  const { clearSession } = useAuthStore()
  const queryClient = useQueryClient()
  const router = useRouter()

  return useMutation({
    mutationFn: (data: ChangePasswordPayload) => passwordService.changePassword(data),
    onSuccess: () => {
      // Server revoked all sessions — clean up client state
      document.cookie = 'is_authenticated=; path=/; max-age=0; SameSite=Strict'
      clearSession()
      queryClient.clear()
      toast.success('Password changed. Please log in again.')
      router.replace('/login')
    }
  })
}
