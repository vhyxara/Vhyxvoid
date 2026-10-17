'use client'

// Blog › Authors: profiles that sign posts. Each is shown under their posts
// (photo, title, bio, links) and has a page at /blog/author/<slug>.
import { useState } from 'react'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Button, Dialog, Skeleton, Table, Text, TextareaField, TextField, toast } from '@vhyxui/react'
import { useQuery } from '@tanstack/react-query'

import { usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { BlogAuthor, BlogAuthorInput } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { ImageField } from '@/views/media/MediaPicker'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:4000').replace(/\/$/, '')
const AREAS = ['blog']
const EMPTY: Required<BlogAuthorInput> = { name: '', slug: '', title: '', bio: '', avatarUrl: '', website: '', twitter: '', github: '', linkedin: '' }

function AuthorDialog({ author, onClose }: { author: BlogAuthor | null; onClose: () => void }) {
  const [f, setF] = useState<Required<BlogAuthorInput>>(author ? { ...EMPTY, ...author } : EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const save = usePlatformMutation(AREAS, (body: BlogAuthorInput) => (author ? platformService.updateBlogAuthor(author.id, body) : platformService.createBlogAuthor({ ...body, name: f.name })))
  const remove = usePlatformMutation(AREAS, () => platformService.deleteBlogAuthor(author!.id))
  const set = (k: keyof BlogAuthorInput) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }))

  const submit = () => {
    if (!f.name.trim()) return setError('Give the author a name.')
    setError(null)
    // A new author gets an address made from the name unless one is typed.
    const { slug, ...rest } = f

    save
      .mutateAsync(slug ? f : rest)
      .then(() => (toast.success(author ? 'Saved' : 'Author added'), onClose()))
      .catch((e: Error) => setError(e.message))
  }

  return (
    <>
      <Dialog open onOpenChange={o => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content style={{ maxInlineSize: 720, inlineSize: 'calc(100vw - 32px)' }}>
            <Dialog.Title>{author ? author.name : 'New author'}</Dialog.Title>
            <Dialog.Description>{author ? `${SITE}/blog/author/${author.slug}` : 'Shown under the posts they sign, with a page of their posts.'}</Dialog.Description>
            <div className='author-form mbs-3'>
              <TextField name='author-name' label='Name' value={f.name} onChange={set('name')} maxLength={80} />
              <TextField name='author-title' label='Title' hint='e.g. Engineer at VhyxVoid' value={f.title} onChange={set('title')} maxLength={120} />
              <TextField name='author-slug' label='Address' hint={`/blog/author/${f.slug || '…'} (made from the name when empty)`} value={f.slug} onChange={set('slug')} maxLength={80} />
              <ImageField name='author-avatar' label='Photo' hint='Square, at least 160×160.' value={f.avatarUrl} onChange={v => setF(x => ({ ...x, avatarUrl: v }))} />
              <div className='author-wide'>
                <TextareaField name='author-bio' label='Bio' hint='A sentence or two, shown under their posts.' rows={3} maxLength={1000} value={f.bio} onChange={set('bio')} />
              </div>
              <TextField name='author-website' label='Website' placeholder='https://…' value={f.website} onChange={set('website')} />
              <TextField name='author-linkedin' label='LinkedIn' placeholder='https://linkedin.com/in/…' value={f.linkedin} onChange={set('linkedin')} />
              <TextField name='author-twitter' label='X' placeholder='handle' value={f.twitter} onChange={set('twitter')} />
              <TextField name='author-github' label='GitHub' placeholder='username' value={f.github} onChange={set('github')} />
            </div>
            {error && (
              <Alert variant='danger' className='mbs-3'>
                {error}
              </Alert>
            )}
            <Dialog.Footer>
              {author && (
                <Button variant='ghost' onClick={() => setConfirm(true)}>
                  Delete…
                </Button>
              )}
              <Button variant='secondary' onClick={onClose}>
                Cancel
              </Button>
              <Button loading={save.isPending} onClick={submit}>
                {author ? 'Save' : 'Add author'}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
      {confirm && author && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setConfirm(false)}
          title={`Delete ${author.name}?`}
          description={author.postCount ? `Their ${author.postCount} post(s) stay, signed with the name only; the author page goes away.` : 'The profile is removed.'}
          confirmLabel='Delete'
          destructive
          requireReason={false}
          onConfirm={() => remove.mutateAsync(undefined as never).then(() => (toast.success('Deleted'), onClose()))}
        />
      )}
    </>
  )
}

export function BlogAuthorsView() {
  const authors = useQuery({ queryKey: ['platform', 'blog', 'authors'], queryFn: platformService.blogAuthors })
  const [open, setOpen] = useState<BlogAuthor | 'new' | null>(null)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Authors'
        description='Profiles that sign blog posts: a photo, title, bio and links under each post, and a page of their posts. Pick the author in a post’s Details.'
        actions={[
          <Button key='new' onClick={() => setOpen('new')}>
            New author
          </Button>
        ]}
      />
      {authors.error && <Alert variant='danger'>{(authors.error as Error).message}</Alert>}
      {authors.isLoading ? (
        <Skeleton height='12rem' />
      ) : !authors.data?.length ? (
        <Alert variant='info'>No authors yet. Posts are signed with a name until you add profiles.</Alert>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.Head>Author</Table.Head>
              <Table.Head>Title</Table.Head>
              <Table.Head>Posts</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {authors.data.map(a => (
              <Table.Row key={a.id}>
                <Table.Cell>
                  <button type='button' className='author-row' onClick={() => setOpen(a)}>
                    {a.avatarUrl ? <img src={a.avatarUrl} alt='' /> : <span aria-hidden>{a.name.slice(0, 1).toUpperCase()}</span>}
                    <span>
                      {a.name}
                      <Text size='xs' tone='muted'>
                        /blog/author/{a.slug}
                      </Text>
                    </span>
                  </button>
                </Table.Cell>
                <Table.Cell>{a.title || '—'}</Table.Cell>
                <Table.Cell>{a.postCount}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
      {open && <AuthorDialog key={open === 'new' ? 'new' : open.id} author={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </div>
  )
}
