'use client'

// Blog posts: drafts, scheduled and published, newest edit first. "New post"
// asks for a title and opens the editor.
import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Badge, Button, Dialog, SelectField, Text, TextField } from '@vhyxui/react'

import { usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { BlogPostRow } from '@/api/platform/types'
import { ServerTable } from '@/components/ui/ServerTable'
import { formatDate } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'
import { useQuery } from '@tanstack/react-query'

export function StateBadge({ state, publishedAt }: { state: BlogPostRow['state']; publishedAt: string | null }) {
  if (state === 'PUBLISHED') return <Badge variant='success' size='sm'>Published</Badge>
  if (state === 'SCHEDULED')
    return (
      <Badge variant='warning' size='sm' title={publishedAt ? `Goes live ${formatDate(publishedAt)}` : undefined}>
        Scheduled
      </Badge>
    )

  return (
    <Badge variant='info' size='sm'>
      Draft
    </Badge>
  )
}

function NewPostDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = usePlatformMutation(['blog'], (t: string) => platformService.createBlogPost({ title: t }))

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>New post</Dialog.Title>
          <Dialog.Description>Starts as a draft. The address (/blog/…) comes from the title; you can change it before publishing.</Dialog.Description>
          <div className='flex flex-col gap-3 mbs-3'>
            <TextField name='new-post-title' label='Title' value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            {error && <Alert variant='danger'>{error}</Alert>}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!title.trim()}
              onClick={() =>
                create
                  .mutateAsync(title.trim())
                  .then((p: any) => router.push(`/blog/${p.id}`))
                  .catch((e: any) => setError(e.message))
              }
            >
              Create draft
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export function BlogPostsView() {
  const { params, set, searchInput, setSearchInput } = useListState(['status', 'category', 'tag'])
  const query = usePlatformList('blog', platformService.blogPosts, params)
  const categories = useQuery({ queryKey: ['platform', 'blog', 'categories'], queryFn: platformService.blogCategories })
  const [newOpen, setNewOpen] = useState(false)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Blog'
        description='Write, schedule and publish posts. Categories and tags you type in a post are created for you.'
        actions={[
          <Button key='t' variant='outline' asChild>
            <Link href='/blog/taxonomy'>Categories & tags</Link>
          </Button>,
          <Button key='n' onClick={() => setNewOpen(true)}>
            New post
          </Button>
        ]}
      />
      <ServerTable<BlogPostRow>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Title or address' }}
        toolbar={
          <div className='flex gap-3 flex-wrap'>
            <div style={{ minInlineSize: 150 }}>
              <SelectField
                name='status'
                label='Status'
                size='sm'
                value={String(params.status ?? 'all')}
                onValueChange={v => set({ status: v === 'all' ? undefined : v })}
                options={[{ value: 'all', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'SCHEDULED', label: 'Scheduled' }, { value: 'PUBLISHED', label: 'Published' }]}
              />
            </div>
            <div style={{ minInlineSize: 180 }}>
              <SelectField
                name='category'
                label='Category'
                size='sm'
                value={String(params.category ?? 'all')}
                onValueChange={v => set({ category: v === 'all' ? undefined : v })}
                options={[{ value: 'all', label: 'All categories' }, ...(categories.data ?? []).map(c => ({ value: c.id, label: `${c.name} (${c.postCount})` }))]}
              />
            </div>
          </div>
        }
        emptyTitle='No posts yet'
        emptyDescription='Write the first one with "New post".'
        columns={[
          {
            key: 'title',
            header: 'Post',
            cell: p => (
              <div className='flex items-center gap-3' style={{ minWidth: 0 }}>
                {p.coverImageUrl ? <img src={p.coverImageUrl} alt='' className='blog-thumb' /> : <span className='blog-thumb blog-thumb-empty' aria-hidden />}
                <div className='flex flex-col' style={{ minWidth: 0 }}>
                  <Link href={`/blog/${p.id}`}>
                    {p.title}
                    {p.featured && (
                      <Text as='span' size='xs' tone='muted'>
                        {' '}
                        · featured
                      </Text>
                    )}
                  </Link>
                  <Text size='xs' tone='muted'>
                    /blog/{p.slug}
                  </Text>
                </div>
              </div>
            )
          },
          { key: 'category', header: 'Category', cell: p => p.category?.name ?? <Text tone='muted'>—</Text> },
          {
            key: 'tags',
            header: 'Tags',
            cell: p => (
              <div className='flex flex-wrap gap-1'>
                {p.tags.slice(0, 3).map(t => (
                  <Badge key={t.id} variant='outline' size='sm'>
                    {t.name}
                  </Badge>
                ))}
                {p.tags.length > 3 && <Text size='xs' tone='muted'>+{p.tags.length - 3}</Text>}
              </div>
            )
          },
          { key: 'state', header: 'Status', cell: p => <StateBadge state={p.state} publishedAt={p.publishedAt} /> },
          { key: 'publishedAt', header: 'Publish date', cell: p => (p.publishedAt ? formatDate(p.publishedAt) : '—') },
          { key: 'updatedAt', header: 'Edited', cell: p => formatDate(p.updatedAt) }
        ]}
      />
      <NewPostDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
