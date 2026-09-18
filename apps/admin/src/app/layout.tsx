import '@/app/globals.css'
import '@vhyxui/tokens'
import '@vhyxui/react/style.css'

// Generated Icon CSS Imports
import '@assets/iconify-icons/generated-icons.css'

import type { ReactNode } from 'react'

import VhyxUIRoot from '@/components/VhyxUIRoot'
import ClientProviders from '@/components/ClientProviders'

export const metadata = {
  title: 'VhyxVoid Admin',
  description: 'Admin console for VhyxVoid — manage admins, roles, abilities, audit logs, and feedback.'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' dir='ltr' suppressHydrationWarning>
      <body>
        <VhyxUIRoot>
          <ClientProviders>{children}</ClientProviders>
        </VhyxUIRoot>
      </body>
    </html>
  )
}
