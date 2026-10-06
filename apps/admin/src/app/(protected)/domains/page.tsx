import { Suspense } from 'react'

import { CustomDomainsView } from '@/views/domains/CustomDomainsView'

export default function Page() {
  return (
    <Suspense>
      <CustomDomainsView />
    </Suspense>
  )
}
