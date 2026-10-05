import { Suspense } from 'react'

import { TunnelsView } from '@/views/tunnels/TunnelsView'

export default function Page() {
  return (
    <Suspense>
      <TunnelsView />
    </Suspense>
  )
}
