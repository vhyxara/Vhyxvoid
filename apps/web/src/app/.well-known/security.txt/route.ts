// /.well-known/security.txt (RFC 9116): where to report a vulnerability.
// The contact is Settings › Support › Security contact, else the support
// email; without either there is nothing to publish and the address is 404.
import { getBootstrap, siteUrl } from '@/views/marketing/publicApi'
import { securityTxt } from '@/views/seo/securityTxt'

export async function GET() {
  const [{ settings }, site] = await Promise.all([getBootstrap(), siteUrl()])
  const body = securityTxt(settings, site)

  if (!body) return new Response('Not found', { status: 404 })

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
