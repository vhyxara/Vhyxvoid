// Type Imports
import type { ChildrenType } from '@core/types'

// Component Imports
import Providers from '@/libs/components/Providers'
import BlankLayout from '@layouts/BlankLayout'

// Util Imports
import { getSystemMode } from '@core/utils/serverHelpers'

type Props = ChildrenType

// Password resets, email checks and invitations aren't search results. Sign-in,
// sign-up and public API docs say otherwise on their own pages.
export const metadata = { robots: { index: false, follow: false } }

const Layout = async (props: Props) => {
  const { children } = props

  // Type guard to ensure lang is a valid Locale

  // Vars
  const direction = 'ltr'
  const systemMode = await getSystemMode()

  return (
    <Providers direction={direction}>
      <BlankLayout systemMode={systemMode}>{children}</BlankLayout>
    </Providers>
  )
}

export default Layout
