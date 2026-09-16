import { dehydrate, HydrationBoundary } from '@tanstack/react-query'

import { createQueryClient } from './queryClient'

export async function withHydration(
  prefetch: (qc: ReturnType<typeof createQueryClient>) => Promise<void>,
  children: React.ReactNode
) {
  const queryClient = createQueryClient()

  await prefetch(queryClient)

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>
}
