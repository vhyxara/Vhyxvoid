'use client'

// Every public address of the website with the title and description it
// shows, where each comes from, and what to fix. "Edit SEO" sets an override
// for that address, which wins over what the page itself says.
import { useMemo, useState } from 'react'

import Link from 'next/link'

import { Alert, Badge, Button, Dialog, Input, SelectField, Skeleton, Switch, Table, Text, TextareaField, TextField, toast } from '@vhyxui/react'
import { useQuery } from '@tanstack/react-query'

import { platformKeys, usePlatformMutation, useSettings } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { SeoLimits, SeoPageRow } from '@/api/platform/types'
import { Counter, SEO_AREAS, SerpPreview, SocialPreview, fullTitle, shareImage, siteOrigin } from './previews'

const KIND: Record<SeoPageRow['kind'], string> = { route: 'Site page', page: 'Page', post: 'Blog post', category: 'Category' }

export function IssueBadge({ row }: { row: SeoPageRow }) {
  if (!row.live) return <Badge size='sm' variant='outline'>draft</Badge>
  if (row.effective.noindex) return <Badge size='sm' variant='default'>hidden from search</Badge>
  const warn = row.issues.filter(i => i.level !== 'info').length
  const info = row.issues.length - warn

  if (warn) return <Badge size='sm' variant='warning' title={row.issues.map(i => i.message).join('\n')}>{warn} to fix</Badge>
  if (info) return <Badge size='sm' variant='info' title={row.issues.map(i => i.message).join('\n')}>{info} tip{info === 1 ? '' : 's'}</Badge>

  return <Badge size='sm' variant='success'>good</Badge>
}

function EditDialog({ row, limits, onClose }: { row: SeoPageRow; limits: SeoLimits; onClose: () => void }) {
  const settings = useSettings()
  const v = (k: string) => settings.data?.settings.find(s => s.key === k)?.value
  const [title, setTitle] = useState(row.override?.title ?? '')
  const [description, setDescription] = useState(row.override?.description ?? '')
  const [imageUrl, setImageUrl] = useState(row.override?.imageUrl ?? '')
  const [noindex, setNoindex] = useState(row.override?.noindex ?? false)
  const [error, setError] = useState<string | null>(null)
  const save = usePlatformMutation(SEO_AREAS, () => platformService.saveSeoPage({ path: row.path, title, description, imageUrl, noindex }))
  const clear = usePlatformMutation(SEO_AREAS, () => platformService.saveSeoPage({ path: row.path, noindex: false }))
  const origin = siteOrigin(v('seo.siteUrl'))
  const product = String(v('general.productName') || 'VhyxVoid')
  const shownTitle = title || row.own.title
  const shownDescription = description || row.own.description || String(v('seo.defaultDescription') ?? '')
  const full = fullTitle(shownTitle, String(v('seo.titleTemplate') ?? ''), product, row.path === '/')
  const image = shareImage(origin, imageUrl || row.own.image, String(v('seo.defaultImage') ?? ''), v('seo.generatedImages') !== false, shownTitle || product)
  const badImage = imageUrl && !/^(https:\/\/\S+|\/(?![/\\])\S*)$/i.test(imageUrl)

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ maxInlineSize: 920, inlineSize: 'calc(100vw - 32px)' }}>
          <Dialog.Title>SEO for {row.path}</Dialog.Title>
          <Dialog.Description>
            Leave a field empty to keep what the {KIND[row.kind].toLowerCase()} says (shown greyed out).{' '}
            {row.editHref && (
              <>
                To change the page itself, <Link href={row.editHref}>edit it here</Link>.
              </>
            )}
          </Dialog.Description>
          <div className='seo-edit mbs-3'>
            <div className='flex flex-col gap-3'>
              <TextField name='seo-title' label='Title' placeholder={row.own.title || product} value={title} maxLength={120} onChange={e => setTitle(e.target.value)} />
              <Counter value={shownTitle} max={limits.title} />
              <TextareaField name='seo-description' label='Description' placeholder={row.own.description || 'No description of its own'} rows={3} maxLength={320} value={description} onChange={e => setDescription(e.target.value)} />
              <Counter value={shownDescription} max={limits.description} min={limits.descriptionMin} />
              <TextField
                name='seo-image'
                label='Share image'
                placeholder={row.own.image || 'https://… or /images/… (1200×630)'}
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
                error={badImage ? 'Use an https:// URL or a path starting with /' : undefined}
              />
              <label className='flex items-center gap-2'>
                <Switch checked={noindex} onCheckedChange={setNoindex} aria-label='Hide from search engines' />
                <Text size='sm'>Hide from search engines (noindex, left out of the sitemap)</Text>
              </label>
              {row.issues.length > 0 && (
                <ul className='seo-issue-list'>
                  {row.issues.map(i => (
                    <li key={i.code} data-level={i.level}>
                      {i.message}
                    </li>
                  ))}
                </ul>
              )}
              {error && <Alert variant='danger'>{error}</Alert>}
            </div>
            <div className='flex flex-col gap-3' style={{ minWidth: 0 }}>
              <Text size='sm' weight='medium'>
                In search results
              </Text>
              {noindex ? <Alert variant='info'>Not shown: hidden from search engines.</Alert> : <SerpPreview url={`${origin}${row.path}`} title={full} description={shownDescription} />}
              <Text size='sm' weight='medium'>
                As a shared link
              </Text>
              <SocialPreview url={`${origin}${row.path}`} title={full} description={shownDescription} image={image} />
            </div>
          </div>
          <Dialog.Footer>
            {row.override && (
              <Button
                variant='ghost'
                loading={clear.isPending}
                onClick={() =>
                  clear
                    .mutateAsync(undefined)
                    .then(() => (toast.success('Override removed'), onClose()))
                    .catch((e: Error) => setError(e.message))
                }
              >
                Remove override
              </Button>
            )}
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              disabled={!!badImage}
              onClick={() =>
                save
                  .mutateAsync(undefined)
                  .then(() => (toast.success('Saved'), onClose()))
                  .catch((e: Error) => setError(e.message))
              }
            >
              Save
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export function SeoPages({ focusPath }: { focusPath?: string }) {
  const q = useQuery({ queryKey: [...platformKeys.area('seo'), 'pages'], queryFn: platformService.seoPages })
  const [kind, setKind] = useState('all')
  const [show, setShow] = useState('all')
  const [search, setSearch] = useState(focusPath ?? '')
  const [editing, setEditing] = useState<string | null>(focusPath ?? null)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()

    return (q.data?.items ?? []).filter(
      r =>
        (kind === 'all' || r.kind === kind) &&
        (show === 'all' || (show === 'issues' ? r.live && !r.effective.noindex && r.issues.some(i => i.level !== 'info') : show === 'override' ? !!r.override : r.effective.noindex)) &&
        (!s || r.path.toLowerCase().includes(s) || r.label.toLowerCase().includes(s) || r.effective.title.toLowerCase().includes(s))
    )
  }, [q.data, kind, show, search])

  if (q.error) return <Alert variant='danger'>{(q.error as Error).message}</Alert>
  if (!q.data) return <Skeleton height='20rem' />
  const editRow = editing ? q.data.items.find(r => r.path === editing) : undefined

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex gap-3 flex-wrap items-end'>
        <div style={{ flex: '1 1 16rem' }}>
          <Input aria-label='Search addresses' placeholder='Search address or title' value={search} onChange={e => setSearch(e.target.value)} size='sm' />
        </div>
        <div style={{ minInlineSize: 150 }}>
          <SelectField name='seo-kind' label='Type' size='sm' value={kind} onValueChange={setKind} options={[{ value: 'all', label: 'All' }, ...Object.entries(KIND).map(([value, label]) => ({ value, label }))]} />
        </div>
        <div style={{ minInlineSize: 170 }}>
          <SelectField
            name='seo-show'
            label='Show'
            size='sm'
            value={show}
            onValueChange={setShow}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'issues', label: 'Needs work' },
              { value: 'override', label: 'With an override' },
              { value: 'noindex', label: 'Hidden from search' }
            ]}
          />
        </div>
      </div>
      <Text size='sm' tone='muted'>
        {rows.length} of {q.data.items.length} addresses. Titles show without the template; search results add it.
      </Text>
      <div style={{ overflowX: 'auto' }}>
        <Table
          density='compact'
          data={rows as any}
          columns={[
            {
              key: 'path',
              header: 'Address',
              cell: (r: any) => (
                <div className='flex flex-col' style={{ minWidth: 0, maxInlineSize: 280 }}>
                  <code style={{ overflowWrap: 'anywhere' }}>{r.path}</code>
                  <Text size='xs' tone='muted'>
                    {KIND[r.kind as SeoPageRow['kind']]}
                    {r.label !== r.path ? ` · ${r.label}` : ''}
                  </Text>
                </div>
              )
            },
            {
              key: 'title',
              header: 'Title & description',
              cell: (r: any) => (
                <div className='flex flex-col' style={{ maxInlineSize: 460 }}>
                  <span>
                    {r.effective.title}
                    {r.effective.titleFrom === 'override' && (
                      <Badge size='sm' variant='outline'>
                        override
                      </Badge>
                    )}
                  </span>
                  <Text size='xs' tone='muted' className='seo-clamp'>
                    {r.effective.description || '— no description'}
                    {r.effective.descriptionFrom === 'default' && r.effective.description ? ' (site default)' : ''}
                  </Text>
                </div>
              )
            },
            { key: 'status', header: 'Status', cell: (r: any) => <IssueBadge row={r} /> },
            {
              key: 'actions',
              header: '',
              cell: (r: any) => (
                <Button size='sm' variant='ghost' onClick={() => setEditing(r.path)}>
                  Edit SEO
                </Button>
              )
            }
          ]}
        />
      </div>
      {editRow && <EditDialog key={editRow.path} row={editRow} limits={q.data.limits} onClose={() => setEditing(null)} />}
    </div>
  )
}
