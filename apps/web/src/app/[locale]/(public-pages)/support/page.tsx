import { SupportView } from '@/views/marketing/SupportView'
import { getBootstrap } from '@/views/marketing/publicApi'

export const metadata = { title: 'Support — VhyxVoid' }

export default async function SupportPage() {
  const { settings } = await getBootstrap()

  return (
    <SupportView
      email={settings['support.email'] || 'support@vhyxvoid.com'}
      docsUrl={settings['support.docsUrl'] || '/docs'}
      statusUrl={settings['general.statusPageUrl'] || undefined}
    />
  )
}
