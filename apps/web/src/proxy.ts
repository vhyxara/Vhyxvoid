import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import createMiddleware from 'next-intl/middleware'

import { routing } from '@/i18n/routing'

// ── Route classification ───────────────────────────────────────────────────
// With localePrefix: 'as-needed', default locale (en) has NO prefix.
// Non-default locales (fr) have prefix: /fr/dashboard
// Both forms must be matched.
// const BARE_REWRITE_PATHS = ['/verify-email', '/verify-email-sent', '/reset-password', '/invitations/accept']

// const PROTECTED_PATTERNS = [/^\/[^/]+\/dashboard/, /^\/[^/]+\/organizations/, /^\/[^/]+\/profile/]

// const GUEST_ONLY_PATTERNS = [/^\/[^/]+\/login/, /^\/[^/]+\/register/, /^\/[^/]+\/forgot-password/]

// const PUBLIC_PATTERNS = [
//   /^\/[^/]+\/verify-email/,
//   /^\/[^/]+\/verify-email-sent/,
//   /^\/[^/]+\/invitations\/accept/,
//   /^\/[^/]+\/reset-password/
// ]

// const LANDING_PATTERNS = [/^\/$/, /^\/pricing/, /^\/docs/, /^\/contact/, /^\/about/]

// function isProtected(p: string) {
//   return PROTECTED_PATTERNS.some(r => r.test(p))
// }

// function isGuestOnly(p: string) {
//   return GUEST_ONLY_PATTERNS.some(r => r.test(p))
// }

// function isPublic(p: string) {
//   return PUBLIC_PATTERNS.some(r => r.test(p))
// }

// function isLanding(p: string) {
//   return LANDING_PATTERNS.some(r => r.test(p))
// }

// const intlMiddleware = createMiddleware(routing)

// export default function middleware(request: NextRequest) {
//   const { pathname } = request.nextUrl

//   // Step 1 — rewrite bare backend-generated paths to default locale
//   const bareMatch = BARE_REWRITE_PATHS.find(p => pathname.startsWith(p))

//   if (bareMatch) {
//     const url = request.nextUrl.clone()

//     url.pathname = `/en${pathname}`

//     return NextResponse.rewrite(url)
//   }

//   // Step 2 — landing pages bypass auth entirely
//   if (isLanding(pathname)) {
//     return intlMiddleware(request)
//   }

//   const intlResponse = intlMiddleware(request)

//   if (intlResponse.status !== 200) return intlResponse

//   const isAuthenticated = request.cookies.get('is_authenticated')?.value === '1'

//   if (isPublic(pathname)) return intlResponse

//   if (isGuestOnly(pathname) && isAuthenticated) {
//     const url = request.nextUrl.clone()
//     const locale = pathname.split('/')[1] || routing.defaultLocale

//     url.pathname = `/${locale}/dashboard`
//     url.searchParams.delete('redirectTo')

//     return NextResponse.redirect(url)
//   }

//   // Protected — redirect unauthenticated to login
//   if (isProtected(pathname) && !isAuthenticated) {
//     const url = request.nextUrl.clone()
//     const locale = pathname.split('/')[1] || routing.defaultLocale

//     url.pathname = `/${locale}/login`
//     url.searchParams.set('redirectTo', pathname)

//     return NextResponse.redirect(url)
//   }

//   return intlResponse
// }

// export const config = {
//   matcher: ['/((?!_next|_vercel|.*\\..*).*)', '/']
// }

// ── Dynamic locale prefix builder ─────────────────────────────────────────
// Builds a regex segment that matches /fr/, /de/, /ja/, etc. OR no prefix.
// Works for any number of locales — just add to routing.ts, nothing else changes.

const localeSegment = routing.locales.join('|') // 'en|fr|de|ja|...'

// Matches: /dashboard  OR  /fr/dashboard  OR  /de/dashboard
const withOrWithout = (path: string) => new RegExp(`^(?:\\/(${localeSegment}))?\\/${path}`)

// ── Route tables ──────────────────────────────────────────────────────────

const PROTECTED = [withOrWithout('dashboard'), withOrWithout('organizations'), withOrWithout('profile')]

const GUEST_ONLY = [withOrWithout('login'), withOrWithout('register'), withOrWithout('forgot-password')]

const PUBLIC = [
  withOrWithout('verify-email'),
  withOrWithout('verify-email-sent'),
  withOrWithout('invitations/accept'),
  withOrWithout('reset-password')
]

const LANDING = [/^\/$/, /^\/pricing/, /^\/docs/, /^\/contact/, /^\/about/]

// ── Bare backend paths — rewritten to default locale internally ───────────
// Backend email links have no locale. We rewrite /verify-email → /en/verify-email
// internally so next-intl resolves the page. Browser URL stays clean.

const BARE_REWRITE_PATHS = ['/verify-email', '/verify-email-sent', '/reset-password', '/invitations/accept']

// ── Helpers ───────────────────────────────────────────────────────────────

const test = (patterns: RegExp[], pathname: string) => patterns.some(p => p.test(pathname))

const intlMiddleware = createMiddleware(routing)

// ── Middleware ────────────────────────────────────────────────────────────

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 0. /docs is proxied to apps/docs (next.config.ts rewrites). Bypass next-intl:
  // it would rewrite /docs to /en/docs, and the docs rewrite would no longer match.
  if (process.env.DOCS_ORIGIN_RESOLVED && (pathname === '/docs' || pathname.startsWith('/docs/'))) {
    return NextResponse.next()
  }

  // 1. Rewrite bare backend-generated paths to default locale
  const bareMatch = BARE_REWRITE_PATHS.find(p => pathname.startsWith(p))

  if (bareMatch) {
    const url = request.nextUrl.clone()

    url.pathname = `/${routing.defaultLocale}${pathname}`

    return NextResponse.rewrite(url)
  }

  // 2. Landing/marketing — no auth, just intl
  if (test(LANDING, pathname)) {
    return intlMiddleware(request)
  }

  const intlResponse = intlMiddleware(request)

  if (intlResponse.status !== 200) return intlResponse

  const isAuthenticated = request.cookies.get('is_authenticated')?.value === '1'

  // 3. Public auth pages — no auth check
  if (test(PUBLIC, pathname)) return intlResponse

  // 4. Guest-only — redirect authenticated users away
  if (test(GUEST_ONLY, pathname) && isAuthenticated) {
    const url = request.nextUrl.clone()
    const seg = pathname.split('/')[1]
    const hasLoc = (routing.locales as readonly string[]).includes(seg)

    url.pathname = hasLoc ? `/${seg}/dashboard` : '/dashboard'
    url.searchParams.delete('redirectTo')

    return NextResponse.redirect(url)
  }

  // 5. Protected — redirect unauthenticated to login
  if (test(PROTECTED, pathname) && !isAuthenticated) {
    const url = request.nextUrl.clone()
    const seg = pathname.split('/')[1]
    const hasLoc = (routing.locales as readonly string[]).includes(seg)

    url.pathname = hasLoc ? `/${seg}/login` : '/login'
    url.searchParams.set('redirectTo', pathname)

    return NextResponse.redirect(url)
  }

  return intlResponse
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)', '/']
}
