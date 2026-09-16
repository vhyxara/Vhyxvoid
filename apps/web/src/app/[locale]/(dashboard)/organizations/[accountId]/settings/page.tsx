import { use } from 'react'

import OrgSettingsView from '@/views/org/OrgSettingsView'

export default function OrgSettingsPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params)

  return <OrgSettingsView accountId={accountId} />
}
