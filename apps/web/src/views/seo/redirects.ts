// The redirects set on the admin SEO screen, applied by src/proxy.ts before
// any page renders. The rules are kept in memory and fetched again after 60 s
// (in the background, so no request waits); /api/revalidate marks them stale
// the moment an admin changes one. The cache lives on globalThis so the proxy
// and the revalidate route share it.
import { normalizeSitePath, resolveRedirect, type RedirectRule } from '@vhyxvoid/content'

const API = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL_LIVE ?? 'http://localhost:9000/api/v1').replace(/\/$/, '')
const TTL_MS = 60_000

type Cache = { rules: RedirectRule[]; at: number; inflight: Promise<RedirectRule[]> | null }
const store = globalThis as typeof globalThis & { __vvRedirects?: Cache }
const cache = (store.__vvRedirects ??= { rules: [], at: 0, inflight: null })

async function load(): Promise<RedirectRule[]> {
  try {
    const res = await fetch(`${API}/public/seo`, { cache: 'no-store', signal: AbortSignal.timeout(1500) })

    if (res.ok) {
      const body = (await res.json()) as { data?: { redirects?: RedirectRule[] } }

      cache.rules = body.data?.redirects ?? []
    }
  } catch {
    // The API is down: keep the rules we had.
  }

  cache.at = Date.now()
  cache.inflight = null

  return cache.rules
}

export async function redirectRules(): Promise<RedirectRule[]> {
  if (Date.now() - cache.at < TTL_MS) return cache.rules
  cache.inflight ??= load()

  // Never fetched: wait for the first copy. Otherwise answer with the old one while it refreshes.
  return cache.at === 0 ? cache.inflight : cache.rules
}

/** After an admin changes redirects (POST /api/revalidate). */
export function markRedirectsStale() {
  cache.at = 0
}

/** For tests. */
export function setRedirectRules(rules: RedirectRule[]) {
  cache.rules = rules
  cache.at = Date.now()
}

/**
 * Where a request should go instead, if anywhere. `locale` is a language
 * prefix the request had (/fr/old): rules are written without it, and a
 * site-path target keeps it. The query string is kept unless the target has
 * its own.
 */
export function redirectFor(rules: RedirectRule[], pathname: string, search: string, locale?: string): { location: string; status: 301 | 302; from: string } | null {
  if (!rules.length) return null
  const bare = locale ? pathname.slice(locale.length + 1) || '/' : pathname
  const path = normalizeSitePath(bare)

  if (!path) return null
  const hit = resolveRedirect(rules, path)

  if (!hit) return null
  const external = /^https?:\/\//i.test(hit.to)
  const target = external ? hit.to : `${locale ? `/${locale}` : ''}${hit.to === '/' && locale ? '' : hit.to}` || '/'
  const location = search && !target.includes('?') ? `${target}${search}` : target

  // A rule that points at the address it was asked for would loop; the API refuses those, this is the last guard.
  if (!external && normalizeSitePath(target) === normalizeSitePath(pathname)) return null

  return { location, status: hit.permanent ? 301 : 302, from: hit.from }
}

/** Counts a use of a redirect on the SEO screen. Fire and forget. */
export function reportRedirectHit(from: string) {
  const secret = process.env.REVALIDATE_SECRET

  if (!secret) return
  fetch(`${API}/public/seo/redirect-hit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
    body: JSON.stringify({ from }),
    signal: AbortSignal.timeout(2000)
  }).catch(() => {})
}
