import { permanentRedirect } from 'next/navigation'

type Props = { params: Promise<{ slug: string[] }> }

// CMS pages used to live under /p/<slug>; they are at /<slug> now. Old links
// get a permanent redirect (308).
export default async function OldCmsPath({ params }: Props) {
  const { slug } = await params

  permanentRedirect(`/${slug.map(s => encodeURIComponent(decodeURIComponent(s))).join('/')}`)
}
