// /media/<id>/<filename> — an image from the media library, on the site's own
// domain (so share images, structured data and pages never point at the
// API). Fetched from the API and cached for a year: an id's bytes never
// change. The file name is only for people and search engines; the id finds it.
const API = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL_LIVE ?? 'http://localhost:9000/api/v1').replace(/\/$/, '')

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function GET(request: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id } = await params

  if (!ID.test(id)) return new Response('Not found', { status: 404 })
  const thumb = new URL(request.url).searchParams.get('thumb') === '1'
  const res = await fetch(`${API}/public/media/${id}${thumb ? '?thumb=1' : ''}`, { next: { revalidate: 31_536_000 } }).catch(() => null)

  if (!res || !res.ok || !res.body) return new Response('Not found', { status: res?.status === 404 ? 404 : 502 })
  const headers = new Headers()

  for (const h of ['content-type', 'content-length', 'content-disposition']) {
    const v = res.headers.get(h)

    if (v) headers.set(h, v)
  }

  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('x-content-type-options', 'nosniff')

  return new Response(res.body, { headers })
}
