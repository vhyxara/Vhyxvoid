import { Suspense } from 'react'

import type { Metadata } from 'next'

import Login from '@/views/auth/Login'
import { routeMetadata } from '@/views/seo/seo'

export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/login')
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  )
}
