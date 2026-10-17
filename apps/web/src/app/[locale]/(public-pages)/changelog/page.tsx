import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { pageParam } from '@/views/blog/meta'
import { ChangelogView } from '@/views/changelog/ChangelogView'
import { getBootstrap, getChangelog } from '@/views/marketing/publicApi'
import { routeMetadata } from '@/views/seo/seo'

type Props = { searchParams: Promise<{ page?: string | string[] }> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = pageParam((await searchParams).page) ?? 1

  return routeMetadata('/changelog', {
    ...(page > 1 ? { title: `Changelog (page ${page})`, path: `/changelog?page=${page}` } : {}),
    extra: { alternates: { types: { 'application/rss+xml': '/changelog/rss.xml' } } }
  })
}

export default async function ChangelogPage({ searchParams }: Props) {
  const page = pageParam((await searchParams).page)

  if (!page) notFound()
  const [list, { settings }] = await Promise.all([getChangelog(page), getBootstrap()])

  if (list && list.total > 0 && page > list.pages) notFound()

  return <ChangelogView list={list} page={page} newsletter={settings['newsletter.enabled'] !== false} />
}
