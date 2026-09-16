import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  // A list of all locales that are supported
  locales: ['en', 'fr'], // this is the ONLY file need to touch

  // Used when no locale matches
  defaultLocale: 'en',
  localePrefix: 'as-needed'
})

export type Routing = typeof routing
