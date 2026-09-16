// Next Imports
import type { Metadata } from 'next'

// Component Imports
import Login from '@/views/auth/Login'

// Server Action Imports
import { getSystemMode } from '@core/utils/serverHelpers'

export const metadata: Metadata = {
  title: 'Login',
  description: 'Login to your account'
}

const LoginPage = async () => {
  // Vars
  const mode = await getSystemMode()

  return <Login mode={mode} />
}

export default LoginPage
