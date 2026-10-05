import { DashboardOverview } from '@/views/dashboard/DashboardOverview'
import { MyAccountsTable } from '@/views/org/MyAccountsTable'

export default function DashboardPage() {
  return (
    <div className='flex flex-col gap-6'>
      <DashboardOverview />
      <MyAccountsTable />
    </div>
  )
}
