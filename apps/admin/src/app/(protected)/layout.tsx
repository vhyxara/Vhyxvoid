import type { ReactNode } from 'react'

import AdminAuthGuard from '@/components/AdminAuthGuard'
import AdminShell from '@/components/AdminShell'

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAuthGuard>
      <AdminShell>{children}</AdminShell>
    </AdminAuthGuard>
  )
}
