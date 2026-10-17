import { Suspense } from 'react'

import { NewsletterView } from '@/views/newsletter/NewsletterView'

export default function Page() {
  return (
    <Suspense>
      <NewsletterView />
    </Suspense>
  )
}
