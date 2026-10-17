'use client'

// Newsletter subscribers: who signed up on the website, who confirmed, who
// left. Blog posts are emailed from the post editor (Publishing). Only
// confirmed subscribers get anything; the export holds only them.
import { useState } from 'react'

import { PageHeader } from '@vhyxui/blocks'
import { Button, SelectField, Text, toast } from '@vhyxui/react'

import { usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { downloadNewsletterCsv, platformService } from '@/api/platform/service'
import type { NewsletterSubscriber } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { ServerTable } from '@/components/ui/ServerTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

const LABEL: Record<NewsletterSubscriber['status'], string> = { PENDING: 'Not confirmed', CONFIRMED: 'Subscribed', UNSUBSCRIBED: 'Unsubscribed' }

/** "post:replay" → "Post: replay"; "footer"/"home"… as they are. */
export function sourceLabel(source: string) {
  if (!source) return '—'
  if (source.startsWith('post:')) return `Post: ${source.slice(5)}`

  return source === 'home' ? 'Home page' : `/${source}`.replace('//', '/')
}

export function NewsletterView() {
  const { params, set, searchInput, setSearchInput } = useListState(['status'])
  const query = usePlatformList('newsletter', platformService.newsletter, params)
  const remove = usePlatformMutation(['newsletter'], (id: string) => platformService.deleteSubscriber(id))
  const [forget, setForget] = useState<NewsletterSubscriber | null>(null)
  const [exporting, setExporting] = useState(false)
  const counts: Partial<Record<NewsletterSubscriber['status'], number>> = query.data?.extra?.counts ?? {}

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Newsletter'
        description='People who signed up with the form on the website. They confirm by email before they get anything. Email a blog post to them from the post editor, under Publishing.'
        actions={[
          <Button
            key='export'
            variant='outline'
            loading={exporting}
            onClick={() => {
              setExporting(true)
              downloadNewsletterCsv()
                .catch((e: Error) => toast.danger(e.message))
                .finally(() => setExporting(false))
            }}
          >
            Export subscribers (CSV)
          </Button>
        ]}
      />
      <div className='newsletter-counts'>
        <div>
          <Text size='xs' tone='muted'>
            Subscribed
          </Text>
          <strong>{counts.CONFIRMED ?? 0}</strong>
        </div>
        <div>
          <Text size='xs' tone='muted'>
            Waiting to confirm
          </Text>
          <strong>{counts.PENDING ?? 0}</strong>
        </div>
        <div>
          <Text size='xs' tone='muted'>
            Unsubscribed
          </Text>
          <strong>{counts.UNSUBSCRIBED ?? 0}</strong>
        </div>
      </div>
      <ServerTable<NewsletterSubscriber>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Email address' }}
        toolbar={
          <div style={{ minInlineSize: 170 }}>
            <SelectField
              name='status'
              label='Show'
              size='sm'
              value={String(params.status ?? 'all')}
              onValueChange={v => set({ status: v === 'all' ? undefined : v })}
              options={[{ value: 'all', label: 'Everyone' }, { value: 'CONFIRMED', label: 'Subscribed' }, { value: 'PENDING', label: 'Not confirmed' }, { value: 'UNSUBSCRIBED', label: 'Unsubscribed' }]}
            />
          </div>
        }
        emptyTitle='No subscribers yet'
        emptyDescription='The sign-up form is shown above the footer of every website page while Settings › Newsletter is on.'
        columns={[
          { key: 'email', header: 'Email', cell: s => <span style={{ userSelect: 'all' }}>{s.email}</span> },
          { key: 'status', header: 'Status', cell: s => <StatusBadge status={s.status === 'CONFIRMED' ? 'ACTIVE' : s.status === 'PENDING' ? 'INCOMPLETE' : 'CANCELED'} label={LABEL[s.status]} /> },
          { key: 'source', header: 'Signed up on', cell: s => sourceLabel(s.source) },
          { key: 'createdAt', header: 'Signed up', cell: s => formatDate(s.createdAt) },
          {
            key: 'actions',
            header: '',
            cell: s => (
              <Button size='xs' variant='ghost' onClick={() => setForget(s)}>
                Delete
              </Button>
            )
          }
        ]}
      />
      {forget && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setForget(null)}
          title={`Delete ${forget.email}?`}
          description='Removes the address for good, for example when someone asks you to erase their data. They can sign up again later. To only stop emails, they can unsubscribe from any email.'
          confirmLabel='Delete'
          destructive
          requireReason={false}
          onConfirm={() => remove.mutateAsync(forget.id).then(() => (toast.success('Deleted'), setForget(null)))}
        />
      )}
    </div>
  )
}
