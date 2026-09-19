import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import { createRelativeLink } from 'fumadocs-ui/mdx'

import { getMDXComponents } from '@/components/mdx'
import { source } from '@/lib/source'

export default async function Page(props: PageProps<'/[[...slug]]'>) {
  const params = await props.params
  const page = source.getPage(params.slug)

  if (!page) notFound()

  const MDX = page.data.body
  const { verified } = page.data

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
      {verified && (
        <p className='mt-12 border-t border-fd-border pt-4 text-xs text-fd-muted-foreground'>
          Last verified {verified.date} against{' '}
          {Object.entries(verified.packages)
            .map(([name, version]) => `${name}@${version}`)
            .join(', ')}
          .
        </p>
      )}
    </DocsPage>
  )
}

export function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: PageProps<'/[[...slug]]'>): Promise<Metadata> {
  const page = source.getPage((await props.params).slug)

  if (!page) notFound()

  return { title: page.data.title, description: page.data.description }
}
