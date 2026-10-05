import { Suspense } from 'react'

import { LogsView } from '@/views/logs/LogsView'

export default function Page() {
  return (
    <Suspense>
      <LogsView />
    </Suspense>
  )
}
