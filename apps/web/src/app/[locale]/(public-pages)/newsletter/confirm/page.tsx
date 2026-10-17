// /newsletter/confirm?token=: the link in the double opt-in email.
import type { Metadata } from 'next'

import { NewsletterConfirm } from '@/views/marketing/Newsletter'

export const metadata: Metadata = { title: 'Confirm your subscription', robots: { index: false, follow: false } }

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return <NewsletterConfirm token={String((await searchParams).token ?? '')} />
}
