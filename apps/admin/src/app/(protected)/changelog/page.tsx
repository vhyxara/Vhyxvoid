import { Suspense } from 'react'

import { ChangelogView } from '@/views/changelog/ChangelogView'

export default function Page() {
  return (
    <Suspense>
      <ChangelogView />
    </Suspense>
  )
}
