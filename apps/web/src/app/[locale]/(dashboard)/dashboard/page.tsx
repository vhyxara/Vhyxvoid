// import { AuthGuard } from '@/domain/identity/guard/AuthGuard'
import { MyAccountsTable } from '@/views/org/MyAccountsTable'

export default function DashboardPage() {
  // <AuthGuard>
  return (
    <>
      <MyAccountsTable />
    </>
  )
}

// </AuthGuard>
