// POST /api/revalidate — the API calls this after an admin publishes,
// unpublishes or deletes content, saves settings or changes SEO, so the site shows the
// change at once instead of after its 60-second cache
// (apps/api/src/modules/platform/content/revalidate.ts).
//
// Header x-revalidate-secret must equal REVALIDATE_SECRET (the API's
// WEB_REVALIDATE_SECRET). Without REVALIDATE_SECRET the route is off (404).
import { timingSafeEqual } from 'node:crypto'

import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

import { CMS_TAG } from '@/views/marketing/publicApi'
import { markRedirectsStale } from '@/views/seo/redirects'

const ALLOWED_TAGS = new Set([CMS_TAG])

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)

  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET

  if (!secret) return NextResponse.json({ message: 'Not found' }, { status: 404 })
  if (!sameSecret(request.headers.get('x-revalidate-secret') ?? '', secret)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { tags?: unknown }
  const tags = (Array.isArray(body.tags) ? body.tags : [CMS_TAG]).filter((t): t is string => typeof t === 'string' && ALLOWED_TAGS.has(t))

  // expire: 0: the next request renders fresh content, rather than serving the cached copy once more.
  for (const tag of tags) revalidateTag(tag, { expire: 0 })
  // Redirects are kept by the proxy, outside Next's cache: fetch them again on the next request.
  markRedirectsStale()

  return NextResponse.json({ revalidated: tags })
}
