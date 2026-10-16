import type { Metadata } from 'next'

import { DocsByHost } from '@/views/apidocs/PublicDocsView'

// Reached only through the middleware rewrite for a customer's docs domain
// (the hub sets x-vhyxvoid-docs-host; see src/proxy.ts).
type Props = { params: Promise<{ host: string }> }

// Customers' public API docs may be found by search engines.
export const metadata: Metadata = { title: 'API docs', robots: { index: true, follow: true } }

export default async function Page({ params }: Props) {
  const { host } = await params

  return <DocsByHost host={decodeURIComponent(host)} />
}
