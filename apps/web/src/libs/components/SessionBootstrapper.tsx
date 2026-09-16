'use client'
import { useBootstrapSession } from '../../api/application/hooks/useBootstrapSession'

// Renders nothing — exists purely to trigger bootstrap on mount.
// Placing it in the root layout means it fires before any page renders.
export function SessionBootstrapper() {
  useBootstrapSession()

  return null
}
