'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Button, Dialog, SelectField, Text, TextField, toast } from '@vhyxui/react'

import { usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { ContentRow } from '@/api/platform/types'
import { ServerTable } from '@/components/ui/ServerTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

const KIND_LABEL: Record<string, string> = { landing: 'Landing page', pricing: 'Pricing page', page: 'Page' }

function NewPageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = usePlatformMutation(['content'], (v: { slug: string; title: string }) => platformService.createContent({ kind: 'page', ...v }))
  const auto = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>New page</Dialog.Title>
          <Dialog.Description>A markdown page at /p/&lt;slug&gt; on the website, e.g. About, Security or a legal page.</Dialog.Description>
          <div className='flex flex-col gap-3 mbs-3'>
            <TextField name='title' label='Title' value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            <TextField name='slug' label='Slug' hint='Lowercase letters, digits, - and /' value={slug || auto} onChange={e => setSlug(e.target.value)} />
            {error && <Alert variant='danger'>{error}</Alert>}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!title.trim()}
              onClick={() => {
                create
                  .mutateAsync({ slug: slug || auto, title: title.trim() })
                  .then((e: any) => router.push(`/content/${e.id}`))
                  .catch((e: any) => setError(e.message))
              }}
            >
              Create draft
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export function ContentListView() {
  const router = useRouter()
  const { params, set, searchInput, setSearchInput } = useListState(['kind', 'status'])
  const query = usePlatformList('content', platformService.content, params)
  const available: Array<{ slug: string; kind: string; title: string }> = query.data?.extra?.available ?? []
  const createDefault = usePlatformMutation(['content'], (e: { slug: string; kind: string; title: string }) => platformService.createContent(e))
  const [newOpen, setNewOpen] = useState(false)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Website content'
        description='Edit the landing page, pricing and other pages. Changes go live when you publish.'
        actions={[
          <Button key='n' onClick={() => setNewOpen(true)}>
            New page
          </Button>
        ]}
      />

      {available.length > 0 && (
        <Alert variant='info' title='Built-in pages using default content'>
          <div className='flex flex-wrap items-center gap-2 mbs-2'>
            {available.map(e => (
              <Button
                key={e.slug}
                size='xs'
                variant='outline'
                loading={createDefault.isPending}
                onClick={() =>
                  createDefault
                    .mutateAsync(e)
                    .then((c: any) => router.push(`/content/${c.id}`))
                    .catch((err: any) => toast.danger(err.message))
                }
              >
                Customize {e.title}
              </Button>
            ))}
          </div>
        </Alert>
      )}

      <ServerTable<ContentRow>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Title or slug' }}
        toolbar={
          <div style={{ minInlineSize: 150 }}>
            <SelectField
              name='status'
              label='Status'
              size='sm'
              value={String(params.status ?? 'all')}
              onValueChange={v => set({ status: v === 'all' ? undefined : v })}
              options={[{ value: 'all', label: 'All' }, { value: 'PUBLISHED', label: 'Published' }, { value: 'DRAFT', label: 'Draft' }, { value: 'ARCHIVED', label: 'Archived' }]}
            />
          </div>
        }
        emptyTitle='No customized content yet'
        emptyDescription='The website is showing built-in defaults. Customize a page above or create a new one.'
        columns={[
          {
            key: 'title',
            header: 'Title',
            cell: r => (
              <div className='flex flex-col'>
                <Link href={`/content/${r.id}`}>{r.title}</Link>
                <Text size='xs' tone='muted'>
                  /{r.slug === 'home' ? '' : r.kind === 'page' ? `p/${r.slug}` : r.slug}
                </Text>
              </div>
            )
          },
          { key: 'kind', header: 'Type', cell: r => KIND_LABEL[r.kind] ?? r.kind },
          { key: 'status', header: 'Status', cell: r => <StatusBadge status={r.status} /> },
          { key: 'version', header: 'Version', align: 'end' },
          { key: 'publishedAt', header: 'Published', cell: r => formatDate(r.publishedAt) },
          { key: 'updatedAt', header: 'Edited', cell: r => formatDate(r.updatedAt) }
        ]}
      />
      <NewPageDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
