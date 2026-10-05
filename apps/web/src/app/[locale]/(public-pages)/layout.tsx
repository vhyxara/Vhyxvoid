// Marketing site: no dashboard providers. The shell (navbar, announcement
// banner, footer) reads admin-controlled settings from the API's public
// bootstrap endpoint, cached 60 s, with safe fallbacks if the API is down.
import '@vhyxui/tokens/reset.css'
import '@vhyxui/blocks/style.css'

import { MarketingShell } from '@/views/marketing/MarketingShell'
import { getBootstrap } from '@/views/marketing/publicApi'

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const bootstrap = await getBootstrap()

  return <MarketingShell bootstrap={bootstrap}>{children}</MarketingShell>
}
