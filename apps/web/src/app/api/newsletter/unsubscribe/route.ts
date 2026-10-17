// POST /api/newsletter/unsubscribe?token=: the one-click unsubscribe of mail
// clients (RFC 8058, the List-Unsubscribe header of newsletter emails). The
// email names the website, not the API, so links stay on the site's domain.
const API = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL_LIVE ?? 'http://localhost:9000/api/v1').replace(/\/$/, '')

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''

  const res = await fetch(`${API}/public/newsletter/unsubscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
    cache: 'no-store'
  }).catch(() => null)

  return new Response(res?.ok ? 'Unsubscribed' : 'Could not unsubscribe', { status: res?.ok ? 200 : (res?.status ?? 502) })
}
