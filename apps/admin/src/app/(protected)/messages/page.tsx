import { Suspense } from 'react'

import { ContactMessagesView } from '@/views/contact/ContactMessagesView'

export default function Page() {
  return (
    <Suspense>
      <ContactMessagesView />
    </Suspense>
  )
}
