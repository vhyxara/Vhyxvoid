import type { Metadata } from 'next'

import Register from '@/views/auth/Register'
import { routeMetadata } from '@/views/seo/seo'

export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/register')
}

export default function RegisterPage() {
  return <Register />
}
