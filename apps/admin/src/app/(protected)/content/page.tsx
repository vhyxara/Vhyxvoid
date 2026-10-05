import { Suspense } from 'react'

import { ContentListView } from '@/views/content/ContentListView'

export default function Page() {
  return (
    <Suspense>
      <ContentListView />
    </Suspense>
  )
}
