// Next Imports
import type { Metadata } from 'next'

import { routeMetadata } from '@/views/seo/seo'

// Component Imports

// Server Action Imports
import { getSystemMode } from '@core/utils/serverHelpers'
import Register from '@/views/auth/Register'

export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/register')
}

const RegisterPage = async () => {
  // Vars
  const mode = await getSystemMode()

  return <Register mode={mode} />
}

export default RegisterPage
