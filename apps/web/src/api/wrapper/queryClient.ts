import { createQueryClient as createSharedQueryClient, ApiError } from '@vhyx/api-kit'
import type { QueryClient } from '@tanstack/react-query'

import toast from 'react-hot-toast'

/**
 * VhyxVoid's wiring of the shared @vhyx/api-kit QueryClient factory --
 * see TABLE_API_ARCHITECTURE_COMPARISON.md and decision.md, 2026-09-15.
 *
 * Uses react-hot-toast, not react-toastify: investigated before "fixing"
 * anything and found this app already has a real, working, mounted
 * <Toaster/> (providers.client.tsx) -- but from react-hot-toast, a
 * SECOND toast library also installed here. The previous version of this
 * file called react-toastify's toast.error(), which had nowhere to
 * render (no <ToastContainer/> anywhere), making every onError handler a
 * silent no-op despite otherwise-correct logic. Wiring onto the library
 * that's actually mounted, rather than adding a second, competing
 * toast-container to the app, is the more correct fix -- see decision.md.
 *
 * 401 handling lives exclusively in http.ts's `onUnauthorized`
 * (refresh-token-queue-then-retry). This layer must NOT also react to the
 * same 401 -- that would race with the retry and could surface a spurious
 * error toast for a request that's about to succeed on its own once the
 * token refreshes. `skipNotify` below preserves that pre-existing
 * constraint (previously enforced by hand in this same file; now
 * expressed as shared-package config instead of duplicated logic).
 *
 * The default retry policy (never retry a 401/403 ApiError; retry
 * anything else up to 2 times) and default staleTime/refetchOnWindowFocus
 * already match what this app had before -- not overridden here.
 */
export function createQueryClient(): QueryClient {
  return createSharedQueryClient({
    onNotify: message => toast.error(message),
    skipNotify: error => error instanceof ApiError && error.status === 401
  })
}
