// import { getRequestConfig } from 'next-intl/server'
// import { defaultLocale, Locale, locales } from '@/configs/utils'
// import { notFound } from 'next/navigation'

// export default getRequestConfig(async ({ requestLocale }) => {
//   //   if (!locale || !locales.includes(locale as Locale)) {
//   //     notFound()
//   //   }
//   //   console.log('locale', locale)
//   //   if (!locale || !locales.includes(locale as Locale)) {
//   //     throw new Error(`Invalid locale: ${locale}`)
//   //   }
//   //   if (locale) {
//   //     console.log('request locale:', locale)
//   //   }

//   //   const resolvedLocale = locale && locales.includes(locale as Locale) ? locale : defaultLocale
//   //   console.log('resolvedLocale', resolvedLocale)
//   let locale = await requestLocale
//   console.log('request locale', locale)
//   if (!locale) {
//     console.log('no locale', locale)
//     return {
//       locale: defaultLocale,
//       messages: (await import(`../data/messages/${defaultLocale}.json`)).default
//     }
//   }

//   // 2️⃣ Validate locale ONLY when present
//   if (!locales.includes(locale as Locale)) {
//     throw new Error(`Unsupported locale: ${locale}`)
//   }
//   console.log('Request locale', locale)
//   // 3️⃣ Resolve locale
//   const resolvedLocale = locale
//   return {
//     locale: resolvedLocale,
//     messages: (await import(`../data/messages/${resolvedLocale}.json`)).default
//   }
// })
import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'

import { routing } from '@/i18n/routing'

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
  let messages

  try {
    messages = (await import(`../data/messages/${locale}.json`)).default
  } catch {
    messages = (await import(`../data/messages/${routing.defaultLocale}.json`)).default
  }

  return {
    locale,
    messages
  }
})
