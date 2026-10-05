import { Suspense } from 'react'

import { UsersView } from '@/views/users/UsersView'

export default function Page() {
  return (
    <Suspense>
      <UsersView />
    </Suspense>
  )
}
