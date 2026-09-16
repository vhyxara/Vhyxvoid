// Type Imports
import type { ChildrenType, Direction } from '@/@core/types'

// Context Imports
import { VerticalNavProvider } from '@/@menu/contexts/verticalNavContext'
import { SettingsProvider } from '@/@core/contexts/settingsContext'
import ThemeProvider from '@/libs/theme'

// Util Imports
import { getMode, getSettingsFromCookie, getSystemMode } from '@core/utils/serverHelpers'

import ClientProviders from '../../api/provider/providers.client'

type Props = ChildrenType & {
  direction: Direction
}

const Providers = async (props: Props) => {
  // Props
  const { children, direction } = props

  // Vars
  const mode = await getMode()
  const settingsCookie = await getSettingsFromCookie()
  const systemMode = await getSystemMode()

  // const [queryClient] = useState(createQueryClient)

  return (
    <VerticalNavProvider>
      <SettingsProvider settingsCookie={settingsCookie} mode={mode}>
        <ThemeProvider direction={direction} systemMode={systemMode}>
          <ClientProviders>{children}</ClientProviders>
        </ThemeProvider>
      </SettingsProvider>
    </VerticalNavProvider>
  )
}

export default Providers
