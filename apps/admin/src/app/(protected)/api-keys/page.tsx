import { Suspense } from 'react'

import { ApiKeysView } from '@/views/api-keys/ApiKeysView'

export default function Page() {
  return (
    <Suspense>
      <ApiKeysView />
    </Suspense>
  )
}
