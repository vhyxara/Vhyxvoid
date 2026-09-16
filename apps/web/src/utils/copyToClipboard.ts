// react-hot-toast, not react-toastify -- only react-hot-toast's <Toaster/>
// is actually mounted (providers.client.tsx). This call was silently
// dead before, same root cause as queryClient.ts's -- see decision.md,
// 2026-09-15, "NEXT_PUBLIC_SECRET_KEY removal, Phase 1 adoption".
import toast from 'react-hot-toast'

export function copyToClipboard(value: string, text: string) {
  navigator.clipboard
    .writeText(value)
    .then(() => {
      toast.success(text || 'Link Copied', { position: 'bottom-left' })
    })
    .catch(err => {
      toast.error('Failed to copy', { position: 'bottom-left' })
    })
}
