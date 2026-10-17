import { defineRouting } from 'next-intl/routing'

// The site is in one language for now: English. The multi-language setup
// stays in place for later (next-intl, the [locale] route segment, the
// messages in data/messages/*.json, the locale-aware proxy), so adding a
// language back is a change here:
//   1. add it to LOCALES (e.g. ['en', 'fr']) and take it out of RETIRED_LOCALES;
//   2. bring its messages in data/messages/<code>.json up to date (fr.json is
//      kept, but new strings since were written in English only).
// See decision.md, 2026-10-17, "One language".
export const LOCALES = ['en'] as const
// export const LOCALES = ['en', 'fr'] as const

/** Languages the site used to serve: their addresses (/fr/pricing) redirect to the English page. */
export const RETIRED_LOCALES: readonly string[] = ['fr']

export const routing = defineRouting({
  locales: [...LOCALES],

  // Used when no locale matches
  defaultLocale: 'en',
  localePrefix: 'as-needed'
})

export type Routing = typeof routing
