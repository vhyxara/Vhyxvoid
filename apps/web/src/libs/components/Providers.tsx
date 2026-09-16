// Type Imports
import type { ChildrenType, Direction } from '@/@core/types'

// Context Imports
import { VerticalNavProvider } from '@/@menu/contexts/verticalNavContext'
import { SettingsProvider } from '@/@core/contexts/settingsContext'

// Util Imports
import { getMode, getSettingsFromCookie, getSystemMode } from '@core/utils/serverHelpers'

import ClientProviders from '../../api/provider/providers.client'
import ModeChanger from '@/libs/theme/ModeChanger'

// `direction` is accepted for backward compatibility with its three call
// sites (all currently hardcode 'ltr') but is otherwise unused now —
// it only ever fed MUI's AppRouterCacheProvider RTL stylis plugin, removed
// along with ThemeProvider/CssBaseline. See decision.md, 2026-09-16,
// "Phase 4 part 3".
type Props = ChildrenType & {
  direction: Direction
}

const Providers = async (props: Props) => {
  // Props
  const { children } = props

  // Vars
  const mode = await getMode()
  const settingsCookie = await getSettingsFromCookie()
  const systemMode = await getSystemMode()

  return (
    <VerticalNavProvider>
      <SettingsProvider settingsCookie={settingsCookie} mode={mode}>
        <ModeChanger systemMode={systemMode} />
        <ClientProviders>{children}</ClientProviders>
      </SettingsProvider>
    </VerticalNavProvider>
  )
}

export default Providers
