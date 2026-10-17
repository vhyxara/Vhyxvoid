// /newsletter/unsubscribe?token=: the link at the bottom of every newsletter email.
import type { Metadata } from 'next'

import { NewsletterUnsubscribe } from '@/views/marketing/Newsletter'

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } }

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return <NewsletterUnsubscribe token={String((await searchParams).token ?? '')} />
}
