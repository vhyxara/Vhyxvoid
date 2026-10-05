import { MutationCache, QueryCache, QueryClient, type QueryClientConfig } from '@tanstack/react-query'

import { ApiError } from './errors'

export type CreateQueryClientOptions = {
  /** Shows a user-facing error (a toast). */
  onNotify?: (message: string, error: unknown) => void
  /** Return true to stay silent for this error (e.g. a 401 being refreshed). */
  skipNotify?: (error: unknown) => boolean
  /** Called once per burst when a request fails with 401 after refresh failed. */
  onSessionExpired?: (error: ApiError) => void
  /** Max retries for queries. Default 2. Client errors other than 408/429 are never retried. */
  retry?: number
  staleTime?: number
  config?: QueryClientConfig
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) return error.message || fallback
  if (error instanceof Error && error.message) return error.message

  return fallback
}

export function shouldRetry(failureCount: number, error: unknown, max = 2): boolean {
  if (error instanceof ApiError && error.isClientError && error.status !== 408 && error.status !== 429) return false

  return failureCount < max
}

/**
 * React Query client with one error policy for the whole app: failed queries
 * and mutations toast once, unless the query/mutation sets `meta: { silent: true }`
 * (it handles its own errors) or `skipNotify` says so.
 */
export function createQueryClient(options: CreateQueryClientOptions = {}): QueryClient {
  const { onNotify, skipNotify, onSessionExpired, retry = 2, staleTime = 30_000, config } = options
  let sessionNotified = false

  const notify = (error: unknown, meta: Record<string, unknown> | undefined) => {
    if (meta?.silent) return
    if (error instanceof ApiError && error.status === 401 && onSessionExpired) {
      if (!sessionNotified) {
        sessionNotified = true
        onSessionExpired(error)
        setTimeout(() => (sessionNotified = false), 5_000)
      }

      return
    }

    if (skipNotify?.(error)) return
    onNotify?.(errorMessage(error), error)
  }

  return new QueryClient({
    ...config,
    queryCache: new QueryCache({ onError: (error, query) => notify(error, query.meta) }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        // A mutation with its own onError reports the failure itself.
        if (mutation.options.onError) return
        notify(error, mutation.meta)
      }
    }),
    defaultOptions: {
      ...config?.defaultOptions,
      queries: {
        staleTime,
        refetchOnWindowFocus: false,
        retry: (count, error) => shouldRetry(count, error, retry),
        ...config?.defaultOptions?.queries
      },
      mutations: { retry: false, ...config?.defaultOptions?.mutations }
    }
  })
}
