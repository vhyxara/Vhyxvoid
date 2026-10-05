import { Suspense } from 'react'

import { SettingsView } from '@/views/settings/SettingsView'

export default function Page() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  )
}
