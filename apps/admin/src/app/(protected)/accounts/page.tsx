import { Suspense } from 'react'

import { AccountsView } from '@/views/accounts/AccountsView'

export default function Page() {
  return (
    <Suspense>
      <AccountsView />
    </Suspense>
  )
}
