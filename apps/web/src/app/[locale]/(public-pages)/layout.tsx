// No Providers, no MUI theme overhead — pure marketing layout.
// Safe to import VhyxUI's reset.css here specifically because this route
// group has no MUI CssBaseline mounted (confirmed by grep, 2026-09-10) —
// see decision.md, "CSS-reset conflict resolved", for why reset.css must
// stay OUT of any route that still has CssBaseline active.
import '@vhyxui/tokens/reset.css'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
