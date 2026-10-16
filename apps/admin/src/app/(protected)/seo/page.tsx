import { Suspense } from 'react'

import { SeoView } from '@/views/seo/SeoView'

export default function Page() {
  return (
    <Suspense>
      <SeoView />
    </Suspense>
  )
}
