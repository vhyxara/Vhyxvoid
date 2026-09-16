// Component Imports
import Providers from '@/libs/components/Providers'
import BlankLayout from '@layouts/BlankLayout'
import NotFound from '@/views/pages/NotFound'

// Util Imports
import { getSystemMode } from '@core/utils/serverHelpers'

const NotFoundPage = async () => {
  // Vars
  const direction = 'ltr'
  const systemMode = await getSystemMode()

  return (
    <Providers direction={direction}>
      <BlankLayout systemMode={systemMode}>
        <NotFound mode={systemMode} />
      </BlankLayout>
    </Providers>
  )
}

export default NotFoundPage
