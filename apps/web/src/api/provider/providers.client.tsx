'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'

import { QueryClientProvider } from '@tanstack/react-query'

import { Toaster } from 'react-hot-toast'

import { createQueryClient } from '@/api/wrapper/queryClient'
import { FeedbackProvider } from '@/contexts/FeedbackContext'
import { SessionBootstrapper } from '@/libs/components/SessionBootstrapper'

export default function ClientProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position='top-right' />
      <FeedbackProvider>
        <SessionBootstrapper />

        {children}
      </FeedbackProvider>
    </QueryClientProvider>
  )
}
