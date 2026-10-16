'use client'

// Blog categories and tags. Posts create them by name as you write, so this
// screen is for tidying up: rename, change the address, describe a category,
// delete, or merge a duplicate tag ("JS" into "JavaScript").
import { useState } from 'react'

import Link from 'next/link'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Button, Dialog, SelectField, Table, Tabs, Text, TextareaField, TextField, toast } from '@vhyxui/react'
import { useQuery } from '@tanstack/react-query'

import { usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { BlogCategoryRow, BlogTagRow } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'

type Kind = 'category' | 'tag'
type Row = (BlogCategoryRow | BlogTagRow) & { description?: string }

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')

/** Create (no row) or edit one category or tag. */
function EditDialog({ kind, row, open, onClose }: { kind: Kind; row: Row | null; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? '')
  const [slug, setSlug] = useState(row?.slug ?? '')
  const [description, setDescription] = useState(row?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const label = kind === 'category' ? 'category' : 'tag'

  const save = usePlatformMutation(['blog'], async () => {
    const body = { name: name.trim(), ...(slug.trim() ? { slug: slug.trim() } : {}), ...(kind === 'category' ? { description: description.trim() } : {}) }

    if (kind === 'category') return row ? platformService.updateBlogCategory(row.id, body) : platformService.createBlogCategory(body)

    return row ? platformService.updateBlogTag(row.id, body) : platformService.createBlogTag(body)
  })

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{row ? `Edit ${label}` : `New ${label}`}</Dialog.Title>
          <Dialog.Description>
            {row && row.postCount > 0
              ? `Changing the address moves /blog/${kind}/${row.slug}; links to the old address stop working.`
              : `Its page is /blog/${kind}/<address>. Leave the address empty to make it from the name.`}
          </Dialog.Description>
          <div className='flex flex-col gap-3 mbs-3'>
            <TextField name={`${kind}-name`} label='Name' value={name} maxLength={60} onChange={e => setName(e.target.value)} autoFocus />
            <TextField name={`${kind}-slug`} label='Address' hint='Lowercase letters, digits and -' value={slug} maxLength={80} onChange={e => setSlug(e.target.value)} />
            {kind === 'category' && (
              <TextareaField
                name='category-description'
                label='Description'
                hint='Shown at the top of the category page'
                rows={3}
                maxLength={300}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            )}
            {error && <Alert variant='danger'>{error}</Alert>}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              disabled={!name.trim()}
              onClick={() =>
                save
                  .mutateAsync(undefined)
                  .then(() => {
                    toast.success(row ? 'Saved' : `${label[0].toUpperCase()}${label.slice(1)} created`)
                    onClose()
                  })
                  .catch(e => setError(errorText(e)))
              }
            >
              {row ? 'Save' : 'Create'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function MergeDialog({ tag, tags, onClose }: { tag: BlogTagRow; tags: BlogTagRow[]; onClose: () => void }) {
  const others = tags.filter(t => t.id !== tag.id)
  const [into, setInto] = useState(others[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const merge = usePlatformMutation(['blog'], () => platformService.mergeBlogTag(tag.id, into))
  const target = others.find(t => t.id === into)

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Merge “{tag.name}”</Dialog.Title>
          <Dialog.Description>
            Its {tag.postCount} post{tag.postCount === 1 ? '' : 's'} get the other tag instead, then “{tag.name}” is deleted.
          </Dialog.Description>
          <div className='flex flex-col gap-3 mbs-3'>
            {others.length ? (
              <SelectField name='merge-into' label='Merge into' value={into} onValueChange={setInto} options={others.map(t => ({ value: t.id, label: `${t.name} (${t.postCount})` }))} />
            ) : (
              <Text tone='muted'>There is no other tag to merge into.</Text>
            )}
            {error && <Alert variant='danger'>{error}</Alert>}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={merge.isPending}
              disabled={!target}
              onClick={() =>
                merge
                  .mutateAsync(undefined)
                  .then(() => {
                    toast.success(`Merged into “${target!.name}”`)
                    onClose()
                  })
                  .catch(e => setError(errorText(e)))
              }
            >
              Merge
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function TaxonomyTable({ kind, rows, loading, tags }: { kind: Kind; rows: Row[]; loading: boolean; tags?: BlogTagRow[] }) {
  const [editing, setEditing] = useState<Row | null | undefined>(undefined) // undefined: closed, null: new
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [merging, setMerging] = useState<BlogTagRow | null>(null)
  const remove = usePlatformMutation(['blog'], (id: string) => (kind === 'category' ? platformService.deleteBlogCategory(id) : platformService.deleteBlogTag(id)))
  const label = kind === 'category' ? 'category' : 'tag'

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-3 flex-wrap'>
        <Text size='sm' tone='muted'>
          {kind === 'category' ? 'A post has one category. ' : 'A post has up to 10 tags. '}
          New ones are also created when a post names one that doesn't exist.
        </Text>
        <Button size='sm' onClick={() => setEditing(null)}>
          New {label}
        </Button>
      </div>
      {loading ? (
        <Text tone='muted'>Loading…</Text>
      ) : rows.length === 0 ? (
        <Alert variant='info'>No {kind === 'category' ? 'categories' : 'tags'} yet. Add one here or type one in a post.</Alert>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table
            density='compact'
            data={rows as any}
            columns={[
              {
                key: 'name',
                header: 'Name',
                cell: (r: any) => (
                  <div className='flex flex-col'>
                    <span>{r.name}</span>
                    {r.description ? (
                      <Text size='xs' tone='muted'>
                        {r.description}
                      </Text>
                    ) : null}
                  </div>
                )
              },
              { key: 'slug', header: 'Address', cell: (r: any) => <code>/blog/{kind}/{r.slug}</code> },
              {
                key: 'postCount',
                header: 'Posts',
                cell: (r: any) => (r.postCount ? <Link href={`/blog?${kind}=${r.id}`}>{r.postCount}</Link> : <Text tone='muted'>0</Text>)
              },
              {
                key: 'actions',
                header: '',
                cell: (r: any) => (
                  <div className='flex gap-1 justify-end'>
                    <Button size='sm' variant='ghost' onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                    {kind === 'tag' && (
                      <Button size='sm' variant='ghost' onClick={() => setMerging(r as BlogTagRow)}>
                        Merge
                      </Button>
                    )}
                    <Button size='sm' variant='ghost' onClick={() => setDeleting(r)}>
                      Delete
                    </Button>
                  </div>
                )
              }
            ]}
          />
        </div>
      )}
      {editing !== undefined && <EditDialog key={editing?.id ?? 'new'} kind={kind} row={editing} open onClose={() => setEditing(undefined)} />}
      {merging && tags && <MergeDialog tag={merging} tags={tags} onClose={() => setMerging(null)} />}
      <ReasonDialog
        open={!!deleting}
        onOpenChange={o => !o && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={
          deleting?.postCount
            ? `${deleting.postCount} post${deleting.postCount === 1 ? '' : 's'} keep${deleting.postCount === 1 ? 's' : ''} going without this ${label}. Its page on the website goes away.`
            : `No posts use this ${label}.`
        }
        confirmLabel='Delete'
        destructive
        requireReason={false}
        onConfirm={() => remove.mutateAsync(deleting!.id).then(() => toast.success('Deleted'))}
      />
    </div>
  )
}

export function BlogTaxonomyView() {
  const categories = useQuery({ queryKey: ['platform', 'blog', 'categories'], queryFn: platformService.blogCategories })
  const tags = useQuery({ queryKey: ['platform', 'blog', 'tags'], queryFn: platformService.blogTags })
  const failed = categories.error ?? tags.error

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader eyebrow={<Link href='/blog'>Blog</Link>} title='Categories & tags' description='Rename, describe, merge or remove the ways posts are grouped on the website.' />
      {failed && <Alert variant='danger'>{errorText(failed)}</Alert>}
      <Tabs defaultValue='categories' variant='underline'>
        <Tabs.List>
          <Tabs.Trigger value='categories'>Categories ({categories.data?.length ?? '…'})</Tabs.Trigger>
          <Tabs.Trigger value='tags'>Tags ({tags.data?.length ?? '…'})</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value='categories'>
          <div className='mbs-4'>
            <TaxonomyTable kind='category' rows={categories.data ?? []} loading={categories.isLoading} />
          </div>
        </Tabs.Content>
        <Tabs.Content value='tags'>
          <div className='mbs-4'>
            <TaxonomyTable kind='tag' rows={tags.data ?? []} loading={tags.isLoading} tags={tags.data ?? []} />
          </div>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
