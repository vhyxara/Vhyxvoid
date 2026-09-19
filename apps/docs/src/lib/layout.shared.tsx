import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'VhyxVoid Docs',
      // The dashboard lives on the same origin, outside this app's basePath.
      url: '/docs'
    },
    // VhyxVoid's dashboard is a near-black "space" theme in both of its modes
    // (see apps/web vhyxui-brand-override.css), so this site is dark-only for
    // now; a light/dark switch would offer a mode that doesn't exist.
    themeSwitch: { enabled: false },
    links: [{ text: 'Dashboard', url: '/dashboard', external: true }]
  }
}
