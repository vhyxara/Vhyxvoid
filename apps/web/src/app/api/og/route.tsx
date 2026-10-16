// GET /api/og?title=… — a 1200×630 share image with the page title and the
// product name, for link previews of pages that have no image of their own
// (views/seo/seo.ts imageFor). Admins turn it off with the "Generate share
// images" SEO setting.
import { ImageResponse } from 'next/og'

import { getBootstrap } from '@/views/marketing/publicApi'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const { settings } = await getBootstrap()
  const product = (settings['general.productName'] || 'VhyxVoid').slice(0, 40)
  const title = (searchParams.get('title') || product).replace(/\s+/g, ' ').trim().slice(0, 120)
  const tagline = (settings['general.tagline'] || '').slice(0, 90)
  const size = title.length > 70 ? 56 : title.length > 40 ? 68 : 80

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: 'radial-gradient(ellipse at 20% 0%, #4c1d95 0%, #0b0b12 60%)',
          color: '#f4f4f5',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, #a78bfa, #7c3aed 60%, #4c1d95)' }} />
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -0.5 }}>{product}</div>
        </div>
        <div style={{ display: 'flex', fontSize: size, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 1040 }}>{title}</div>
        <div style={{ display: 'flex', fontSize: 28, color: '#a1a1aa' }}>{tagline}</div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' }
    }
  )
}
