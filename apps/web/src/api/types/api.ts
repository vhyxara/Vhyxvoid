// ApiError moved to the shared @vhyx/api-kit package (2026-09-15) -- it must
// stay the SAME class the shared httpClient/QueryClient throw and check
// against, so this re-exports it rather than defining a second, different
// ApiError class here. See TABLE_API_ARCHITECTURE_COMPARISON.md and
// decision.md.
export { ApiError } from '@vhyx/api-kit'

import type { ApiError } from '@vhyx/api-kit'

export type ApiSuccess<T> = {
  success: true
  data: T
  message?: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError
