// Next Imports
import type { Metadata } from 'next'

import { routeMetadata } from '@/views/seo/seo'

// Component Imports
import Login from '@/views/auth/Login'

// Server Action Imports
import { getSystemMode } from '@core/utils/serverHelpers'

export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/login')
}

const LoginPage = async () => {
  // Vars
  const mode = await getSystemMode()

  return <Login mode={mode} />
}

export default LoginPage
