'use client'

// The changelog: release notes shown on the website at /changelog (and its
// RSS feed). Entries are drafts until published; the date shown is the
// publish date, which can be set (a future date waits until then).
import { useState } from 'react'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Badge, Button, Dialog, Text, TextField, toast } from '@vhyxui/react'

import { usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { ChangelogEntry, ChangelogInput, ChangelogKind } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { ServerTable } from '@/components/ui/ServerTable'
import { formatDate } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'
import { RichTextEditor } from '@/views/content/RichTextEditor'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:4000').replace(/\/$/, '')
export const KINDS: Array<{ value: ChangelogKind; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'improved', label: 'Improved' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'security', label: 'Security' }
]

const localInput = (iso: string) => {
  const d = new Date(iso)

  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Draft, Scheduled (published, dated later) or Published. */
export function entryState(e: Pick<ChangelogEntry, 'status' | 'publishedAt'>, now = Date.now()) {
  if (e.status !== 'PUBLISHED') return 'Draft'

  return e.publishedAt && new Date(e.publishedAt).getTime() > now ? 'Scheduled' : 'Published'
}

type Draft = { version: string; title: string; body: string; kinds: ChangelogKind[]; date: string }

function Editor({ entry, onClose }: { entry: ChangelogEntry | null; onClose: () => void }) {
  const [d, setD] = useState<Draft>({
    version: entry?.version ?? '',
    title: entry?.title ?? '',
    body: entry?.body ?? '',
    kinds: entry?.kinds ?? [],
    date: entry?.publishedAt ? localInput(entry.publishedAt) : ''
  })
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const save = usePlatformMutation(['changelog'], (body: ChangelogInput) => (entry ? platformService.updateChangelog(entry.id, body) : platformService.createChangelog({ ...body, title: d.title })))
  const remove = usePlatformMutation(['changelog'], () => platformService.deleteChangelog(entry!.id))
  const published = entry?.status === 'PUBLISHED'

  const run = (status: 'DRAFT' | 'PUBLISHED', message: string) => {
    if (!d.title.trim()) return setError('Give the entry a title.')
    setError(null)
    save
      .mutateAsync({ version: d.version.trim(), title: d.title.trim(), body: d.body, kinds: d.kinds, status, ...(d.date ? { publishedAt: new Date(d.date).toISOString() } : {}) })
      .then(() => (toast.success(message), onClose()))
      .catch((e: Error) => setError(e.message))
  }

  const toggle = (k: ChangelogKind) => setD(x => ({ ...x, kinds: x.kinds.includes(k) ? x.kinds.filter(y => y !== k) : KINDS.map(o => o.value).filter(v => v === k || x.kinds.includes(v)) }))

  return (
    <>
      <Dialog open onOpenChange={o => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content style={{ maxInlineSize: 860, inlineSize: 'calc(100vw - 32px)' }}>
            <Dialog.Title>{entry ? 'Edit changelog entry' : 'New changelog entry'}</Dialog.Title>
            <Dialog.Description>{entry ? `${entryState(entry)}${entry.publishedAt ? ` · dated ${formatDate(entry.publishedAt)}` : ''}` : 'Shown on the website at /changelog once published.'}</Dialog.Description>
            <div className='flex flex-col gap-4 mbs-3'>
              <div className='changelog-fields'>
                <TextField name='changelog-version' label='Version' hint='Optional, e.g. 1.8.0' value={d.version} onChange={e => setD(x => ({ ...x, version: e.target.value }))} maxLength={40} />
                <TextField name='changelog-title' label='Title' value={d.title} onChange={e => setD(x => ({ ...x, title: e.target.value }))} maxLength={160} />
                <TextField name='changelog-date' label='Date' hint='Empty: the day you publish. A later date waits until then.' type='datetime-local' value={d.date} onChange={e => setD(x => ({ ...x, date: e.target.value }))} />
              </div>
              <div className='flex flex-col gap-2'>
                <Text size='sm' weight='medium'>
                  Labels
                </Text>
                <div className='flex gap-2 flex-wrap' role='group' aria-label='Labels'>
                  {KINDS.map(k => (
                    <Button key={k.value} size='sm' variant={d.kinds.includes(k.value) ? 'primary' : 'outline'} aria-pressed={d.kinds.includes(k.value)} onClick={() => toggle(k.value)}>
                      {k.label}
                    </Button>
                  ))}
                </div>
              </div>
              <RichTextEditor value={d.body} onChange={body => setD(x => ({ ...x, body }))} contactForm={false} label='Release notes' />
              {error && <Alert variant='danger'>{error}</Alert>}
            </div>
            <Dialog.Footer>
              {entry && (
                <Button variant='ghost' onClick={() => setConfirmDelete(true)}>
                  Delete…
                </Button>
              )}
              {published ? (
                <>
                  <Button variant='outline' loading={save.isPending} onClick={() => run('DRAFT', 'Unpublished')}>
                    Unpublish
                  </Button>
                  <Button loading={save.isPending} onClick={() => run('PUBLISHED', 'Saved')}>
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <Button variant='outline' loading={save.isPending} onClick={() => run('DRAFT', 'Draft saved')}>
                    Save draft
                  </Button>
                  <Button loading={save.isPending} onClick={() => run('PUBLISHED', d.date && new Date(d.date).getTime() > Date.now() ? 'Scheduled' : 'Published')}>
                    Publish
                  </Button>
                </>
              )}
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
      {confirmDelete && entry && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setConfirmDelete(false)}
          title={`Delete “${entry.title}”?`}
          description={published ? 'It disappears from the changelog and its feed.' : 'The draft is removed for good.'}
          confirmLabel='Delete'
          destructive
          requireReason={false}
          onConfirm={() => remove.mutateAsync(undefined as never).then(() => (toast.success('Deleted'), onClose()))}
        />
      )}
    </>
  )
}

export function ChangelogView() {
  const { params, set, searchInput, setSearchInput } = useListState([])
  const query = usePlatformList('changelog', platformService.changelog, params)
  const [open, setOpen] = useState<ChangelogEntry | 'new' | null>(null)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Changelog'
        description={
          <>
            Release notes for the website’s{' '}
            <a href={`${SITE}/changelog`} target='_blank' rel='noreferrer'>
              /changelog
            </a>{' '}
            page and its RSS feed. The footer links to it once an entry is published.
          </>
        }
        actions={[
          <Button key='new' onClick={() => setOpen('new')}>
            New entry
          </Button>
        ]}
      />
      <ServerTable<ChangelogEntry>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Title or version' }}
        emptyTitle='No entries yet'
        emptyDescription='Write the first release notes with New entry.'
        columns={[
          {
            key: 'title',
            header: 'Entry',
            cell: e => (
              <button type='button' className='contact-row-open' onClick={() => setOpen(e)}>
                <span>{e.title}</span>
                {e.version && (
                  <Text size='xs' tone='muted'>
                    v{e.version.replace(/^v/i, '')}
                  </Text>
                )}
              </button>
            )
          },
          { key: 'kinds', header: 'Labels', cell: e => (e.kinds.length ? e.kinds.map(k => KINDS.find(x => x.value === k)?.label).join(', ') : '—') },
          {
            key: 'status',
            header: 'Status',
            cell: e => {
              const s = entryState(e)

              return (
                <Badge size='sm' variant={s === 'Published' ? 'success' : s === 'Scheduled' ? 'info' : 'outline'}>
                  {s}
                </Badge>
              )
            }
          },
          { key: 'publishedAt', header: 'Date', cell: e => (e.publishedAt ? formatDate(e.publishedAt) : '—') }
        ]}
      />
      {open && <Editor key={open === 'new' ? 'new' : open.id} entry={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </div>
  )
}
