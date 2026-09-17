'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'

import { QueryClientProvider } from '@tanstack/react-query'

import { createQueryClient } from '@/api/wrapper/queryClient'
import { FeedbackProvider } from '@/contexts/FeedbackContext'

export default function ClientProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>{children}</FeedbackProvider>
    </QueryClientProvider>
  )
}
