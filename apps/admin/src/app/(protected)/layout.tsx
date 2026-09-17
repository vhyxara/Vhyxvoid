import type { ReactNode } from 'react'

import AdminAuthGuard from '@/components/AdminAuthGuard'
import DashboardShell from '@/components/DashboardShell'

// Minimal dashboard-shell placeholder, per Part 1.5 -- a real
// sidebar/nav system comes once there are enough real screens to navigate
// between (screens 3-7, later sessions). This just gates the route group
// on a valid session and renders a thin top bar with the 7 planned
// screens' nav links (5 of them still stubs) and a working logout button.
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAuthGuard>
      <DashboardShell>{children}</DashboardShell>
    </AdminAuthGuard>
  )
}
