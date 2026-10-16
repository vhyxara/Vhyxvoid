// The 404 page for paths under a locale (no route, and no CMS page at that
// slug). Rendered by notFound(), so the response status is a real 404 rather
// than a 200 "soft 404" that search engines would index.
import Providers from '@/libs/components/Providers'
import BlankLayout from '@layouts/BlankLayout'
import NotFound from '@/views/pages/NotFound'

import { getSystemMode } from '@core/utils/serverHelpers'

export default async function LocaleNotFound() {
  const systemMode = await getSystemMode()

  return (
    <Providers direction='ltr'>
      <BlankLayout systemMode={systemMode}>
        <NotFound mode={systemMode} />
      </BlankLayout>
    </Providers>
  )
}
