'use client'

// Redirects: old addresses the website sends somewhere else. Permanent (301)
// tells search engines to move the old page's ranking to the new address;
// temporary (302) doesn't. "/old/*" covers everything under /old.
import { useEffect, useState } from 'react'

import { Alert, Badge, Button, Dialog, SelectField, Text, TextareaField, TextField, toast } from '@vhyxui/react'

import { usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { SeoRedirectRow } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { ServerTable } from '@/components/ui/ServerTable'
import { formatDate } from '@/components/ui/format'
import { SEO_AREAS } from './previews'

/** Search typed into a box, sent to the server once typing pauses. */
export function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)

    return () => clearTimeout(t)
  }, [value, ms])

  return v
}

export function RedirectDialog({ row, initialFrom = '', onClose }: { row: SeoRedirectRow | null; initialFrom?: string; onClose: () => void }) {
  const [from, setFrom] = useState(row?.fromPath ?? initialFrom)
  const [to, setTo] = useState(row?.toUrl ?? '')
  const [permanent, setPermanent] = useState(row ? String(row.permanent) : 'true')
  const [note, setNote] = useState(row?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = usePlatformMutation(SEO_AREAS, () => {
    const body = { from, to, permanent: permanent === 'true', note }

    return row ? platformService.updateSeoRedirect(row.id, body) : platformService.createSeoRedirect(body)
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{row ? 'Edit redirect' : 'New redirect'}</Dialog.Title>
          <Dialog.Description>Visitors and search engines asking for the old address are sent to the new one. End the old address with /* to cover everything under it.</Dialog.Description>
          <div className='flex flex-col gap-3 mbs-3'>
            <TextField name='redirect-from' label='Old address' placeholder='/old-page or /old-section/*' value={from} onChange={e => setFrom(e.target.value)} autoFocus={!initialFrom} />
            <TextField
              name='redirect-to'
              label='New address'
              placeholder='/new-page or https://…'
              hint={from.trim().endsWith('/*') ? 'End it with /* too to keep the rest of the path: /old/* → /new/* sends /old/a to /new/a.' : 'A path on this site or a full https:// URL.'}
              value={to}
              onChange={e => setTo(e.target.value)}
              autoFocus={!!initialFrom}
            />
            <SelectField
              name='redirect-type'
              label='Type'
              value={permanent}
              onValueChange={setPermanent}
              options={[
                { value: 'true', label: 'Permanent (301): the page has moved for good' },
                { value: 'false', label: 'Temporary (302): it will come back' }
              ]}
            />
            <TextField name='redirect-note' label='Note' hint='Optional: why it exists' value={note} maxLength={200} onChange={e => setNote(e.target.value)} />
            {error && <Alert variant='danger'>{error}</Alert>}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              disabled={!from.trim() || !to.trim()}
              onClick={() =>
                save
                  .mutateAsync(undefined)
                  .then(() => (toast.success(row ? 'Saved' : 'Redirect added'), onClose()))
                  .catch((e: Error) => setError(e.message))
              }
            >
              {row ? 'Save' : 'Add redirect'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState('')
  const [result, setResult] = useState<{ created: number; updated: number; errors: Array<{ line: number; message: string }> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = usePlatformMutation(SEO_AREAS, () => platformService.importSeoRedirects(lines))

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ maxInlineSize: 720, inlineSize: 'calc(100vw - 32px)' }}>
          <Dialog.Title>Import redirects</Dialog.Title>
          <Dialog.Description>
            One per line: old address, new address, and optionally 302 for a temporary one. Separate with spaces, commas or tabs, so a CSV or a sheet pasted in works. Lines starting with # are
            skipped; an old address that already has a redirect gets the new target.
          </Dialog.Description>
          <div className='flex flex-col gap-3 mbs-3'>
            <TextareaField
              name='redirect-lines'
              label='Redirects'
              rows={10}
              placeholder={'/old-pricing /pricing\n/blog/2023/* /blog/*\n/summer-sale /pricing 302'}
              value={lines}
              onChange={e => setLines(e.target.value)}
              style={{ fontFamily: 'var(--vhyx-font-mono, monospace)' }}
            />
            {result && (
              <Alert variant={result.errors.length ? 'warning' : 'success'} title={`${result.created} added, ${result.updated} replaced${result.errors.length ? `, ${result.errors.length} skipped` : ''}`}>
                {result.errors.length > 0 && (
                  <ul className='seo-issue-list'>
                    {result.errors.slice(0, 20).map(e => (
                      <li key={e.line} data-level='warning'>
                        Line {e.line}: {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}
            {error && <Alert variant='danger'>{error}</Alert>}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              {result ? 'Done' : 'Cancel'}
            </Button>
            <Button loading={run.isPending} disabled={!lines.trim()} onClick={() => run.mutateAsync(undefined).then(setResult).catch((e: Error) => setError(e.message))}>
              Import
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export function SeoRedirects() {
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput)
  const query = usePlatformList('seo-redirects', platformService.seoRedirects, { page, limit: 25, ...(search ? { search } : {}) })
  const [editing, setEditing] = useState<SeoRedirectRow | null | undefined>(undefined)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState<SeoRedirectRow | null>(null)
  const remove = usePlatformMutation(SEO_AREAS, (id: string) => platformService.deleteSeoRedirect(id))

  useEffect(() => setPage(1), [search])

  return (
    <div className='flex flex-col gap-3'>
      <ServerTable<SeoRedirectRow>
        query={query}
        page={page}
        onPageChange={setPage}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Old or new address' }}
        toolbar={
          <div className='flex gap-2'>
            <Button size='sm' variant='outline' onClick={() => setImporting(true)}>
              Import…
            </Button>
            <Button size='sm' onClick={() => setEditing(null)}>
              New redirect
            </Button>
          </div>
        }
        emptyTitle='No redirects'
        emptyDescription='Add one when a page moves, so old links and search results keep working. Missing addresses visitors ask for show under Not found.'
        columns={[
          {
            key: 'from',
            header: 'Old address',
            cell: r => (
              <div className='flex flex-col'>
                <code style={{ overflowWrap: 'anywhere' }}>{r.fromPath}</code>
                {r.note && (
                  <Text size='xs' tone='muted'>
                    {r.note}
                  </Text>
                )}
              </div>
            )
          },
          { key: 'to', header: 'Goes to', cell: r => <code style={{ overflowWrap: 'anywhere' }}>{r.toUrl}</code> },
          {
            key: 'type',
            header: 'Type',
            cell: r => (
              <Badge size='sm' variant={r.permanent ? 'default' : 'outline'}>
                {r.permanent ? '301 permanent' : '302 temporary'}
              </Badge>
            )
          },
          { key: 'hits', header: 'Used', cell: r => (r.hits ? `${r.hits.toLocaleString()} · last ${formatDate(r.lastHitAt!)}` : <Text tone='muted'>not yet</Text>) },
          {
            key: 'actions',
            header: '',
            cell: r => (
              <div className='flex gap-1 justify-end'>
                <Button size='sm' variant='ghost' onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Button size='sm' variant='ghost' onClick={() => setDeleting(r)}>
                  Delete
                </Button>
              </div>
            )
          }
        ]}
      />
      <Text size='xs' tone='muted'>
        The website picks up changes within a minute. Counts come from the website as visitors follow each redirect.
      </Text>
      {editing !== undefined && <RedirectDialog key={editing?.id ?? 'new'} row={editing} onClose={() => setEditing(undefined)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      <ReasonDialog
        open={!!deleting}
        onOpenChange={o => !o && setDeleting(null)}
        title={`Delete the redirect from ${deleting?.fromPath ?? ''}?`}
        description='Visitors to the old address get a "not found" page again.'
        confirmLabel='Delete'
        destructive
        requireReason={false}
        onConfirm={() => remove.mutateAsync(deleting!.id).then(() => toast.success('Redirect removed'))}
      />
    </div>
  )
}
