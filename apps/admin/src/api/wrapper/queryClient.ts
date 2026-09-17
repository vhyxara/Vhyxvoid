import { createQueryClient as createSharedQueryClient, ApiError } from '@vhyx/api-kit'
import type { QueryClient } from '@tanstack/react-query'

import { toast } from '@vhyxui/react'

// apps/admin's wiring of the shared @vhyx/api-kit QueryClient factory.
// Uses VhyxUI's own toast() (mounted via VhyxUIProvider in
// components/VhyxUIRoot.tsx) rather than apps/web's react-hot-toast --
// apps/admin has no legacy second toast library to route around, and
// VhyxUI already ships a real imperative toast API, so there's no reason
// to add another dependency apps/web only carries for its own history.
//
// 401 handling lives exclusively in wrapper/http.ts's `onUnauthorized`
// (refresh-then-retry). This layer must not also react to the same 401 --
// see apps/web's identical queryClient.ts comment for why (a race between
// this toast and the retry that's about to succeed on its own).
export function createQueryClient(): QueryClient {
  return createSharedQueryClient({
    // VhyxUI's toast has no `.error()` -- its danger/failure variant is
    // named `.danger()` (confirmed by reading packages/react/src/toast/toast.ts
    // directly, and matching the exact call apps/web's own Login.tsx uses).
    onNotify: message => toast.danger(message),
    skipNotify: error => error instanceof ApiError && error.status === 401
  })
}
