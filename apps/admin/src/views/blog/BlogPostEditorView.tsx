'use client'

// One blog post: write (rich text stored as markdown), describe (cover,
// excerpt, category, tags), get found (address, SEO), and publish now, on a
// schedule, or take it back to draft. Category and tag names that don't exist
// yet are created when the post is saved.
import { useEffect, useId, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Button, Skeleton, Switch, Tabs, Text, TextareaField, TextField, toast } from '@vhyxui/react'
import { useQuery } from '@tanstack/react-query'

import { usePlatformDetail, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { BlogPostDetail, BlogPostInput } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { formatDate } from '@/components/ui/format'
import { RichTextEditor, imageProblem } from '@/views/content/RichTextEditor'
import { StateBadge } from './BlogPostsView'
import { TagInput } from './TagInput'
import { ImageField } from '@/views/media/MediaPicker'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:4000').replace(/\/$/, '')

type Draft = Required<Omit<BlogPostInput, 'expectedUpdatedAt' | 'coverImageUrl' | 'category' | 'seoTitle' | 'seoDescription'>> & {
  coverImageUrl: string
  category: string
  seoTitle: string
  seoDescription: string
}

export function draftOf(p: BlogPostDetail): Draft {
  return {
    title: p.title,
    slug: p.slug,
    excerpt: p.excerpt,
    body: p.body,
    coverImageUrl: p.coverImageUrl ?? '',
    coverImageAlt: p.coverImageAlt,
    category: p.category?.name ?? '',
    tags: p.tags.map(t => t.name),
    featured: p.featured,
    authorName: p.authorName,
    seoTitle: p.seoTitle ?? '',
    seoDescription: p.seoDescription ?? ''
  }
}

/** Only the fields that changed, in the API's shape (empty strings become null where the API takes null). */
export function changesOf(before: Draft, after: Draft): BlogPostInput {
  const out: BlogPostInput = {}

  for (const k of Object.keys(after) as Array<keyof Draft>) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue
    const v = after[k]

    ;(out as any)[k] = (k === 'coverImageUrl' || k === 'category' || k === 'seoTitle' || k === 'seoDescription') && v === '' ? null : v
  }

  return out
}

/** "2026-10-20T09:30" in the browser's time zone, for a datetime-local input. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <Text size='xs' tone={value.length > max ? 'danger' : 'muted'}>
      {value.length}/{max}
    </Text>
  )
}

export function BlogPostEditorView({ id }: { id: string }) {
  const router = useRouter()
  const { data: post, isLoading, error } = usePlatformDetail('blog', id, platformService.blogPost)
  const categories = useQuery({ queryKey: ['platform', 'blog', 'categories'], queryFn: platformService.blogCategories })
  const tags = useQuery({ queryKey: ['platform', 'blog', 'tags'], queryFn: platformService.blogTags })
  const [d, setD] = useState<Draft | null>(null)
  const [confirm, setConfirm] = useState<null | 'delete' | 'unpublish'>(null)
  const [scheduleAt, setScheduleAt] = useState('')
  const catList = useId()

  useEffect(() => {
    if (post) setD(draftOf(post))
  }, [post])

  const save = usePlatformMutation(['blog'], (changes: BlogPostInput) => platformService.saveBlogPost(id, { ...changes, expectedUpdatedAt: post?.updatedAt }))
  const publish = usePlatformMutation(['blog'], (at?: string) => platformService.publishBlogPost(id, at))
  const unpublish = usePlatformMutation(['blog'], () => platformService.unpublishBlogPost(id))

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (isLoading || !post || !d) return <Skeleton height='24rem' />

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => (x ? { ...x, [k]: v } : x))
  const changes = changesOf(draftOf(post), d)
  const dirty = Object.keys(changes).length > 0
  const coverProblem = d.coverImageUrl ? imageProblem(d.coverImageUrl) : null
  const slugProblem = d.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug) ? 'Use lowercase letters, digits and -' : null
  const live = post.state === 'PUBLISHED'

  const onSave = () =>
    save
      .mutateAsync(changes)
      .then(() => toast.success('Saved'))
      .catch((e: any) => toast.danger(e.message))

  const onPublish = (at?: string) =>
    publish
      .mutateAsync(at)
      .then((p: any) => toast.success(p.state === 'SCHEDULED' ? `Scheduled for ${formatDate(p.publishedAt)}` : 'Published'))
      .catch((e: any) => toast.danger(e.message))

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        eyebrow={<Link href='/blog'>Blog</Link>}
        title={
          <span className='flex items-center gap-3 flex-wrap'>
            {post.title} <StateBadge state={post.state} publishedAt={post.publishedAt} />
          </span>
        }
        description={`/blog/${post.slug} · ${post.readingMinutes} min read · by ${post.authorName || '—'}${post.publishedAt ? ` · ${post.state === 'SCHEDULED' ? 'goes live' : 'published'} ${formatDate(post.publishedAt)}` : ''}`}
        actions={[
          ...(live
            ? [
                <Button key='v' variant='ghost' onClick={() => window.open(`${SITE}/blog/${post.slug}`, '_blank')}>
                  View on site ↗
                </Button>
              ]
            : []),
          <Button key='s' variant={dirty ? 'primary' : 'outline'} disabled={!dirty || !!coverProblem || !!slugProblem} loading={save.isPending} onClick={onSave}>
            Save
          </Button>,
          ...(post.status === 'DRAFT'
            ? [
                <Button key='p' disabled={dirty} loading={publish.isPending} onClick={() => onPublish()}>
                  Publish now
                </Button>
              ]
            : [
                <Button key='u' variant='outline' onClick={() => setConfirm('unpublish')}>
                  Back to draft
                </Button>
              ])
        ]}
      />
      {dirty && <Alert variant='info'>Unsaved changes. Save before publishing{live ? '; saved changes to a published post go live straight away' : ''}.</Alert>}

      <Tabs defaultValue='write' variant='underline'>
        <Tabs.List>
          <Tabs.Trigger value='write'>Write</Tabs.Trigger>
          <Tabs.Trigger value='details'>Details</Tabs.Trigger>
          <Tabs.Trigger value='seo'>Address & SEO</Tabs.Trigger>
          <Tabs.Trigger value='publish'>Publishing</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value='write'>
          <div className='flex flex-col gap-3'>
            <TextField name='post-title' label='Title' value={d.title} onChange={e => set('title', e.target.value)} error={!d.title.trim() ? 'Give the post a title' : undefined} />
            <RichTextEditor value={d.body} onChange={v => set('body', v)} contactForm={false} label='Post body' />
          </div>
        </Tabs.Content>

        <Tabs.Content value='details'>
          <div className='blog-details'>
            <div className='flex flex-col gap-3'>
              <TextareaField name='post-excerpt' label='Excerpt' hint='One or two sentences for the blog list and link previews. Empty: the start of the post is used.' rows={3} value={d.excerpt} onChange={e => set('excerpt', e.target.value)} />
              <Counter value={d.excerpt} max={300} />
              <div className='flex flex-col gap-1'>
                <TextField name='post-category' label='Category' hint='Pick one or type a new name; new ones are created when you save.' value={d.category} onChange={e => set('category', e.target.value)}
                  // An existing category typed in another case is that category: show its own name.
                  onBlur={() => {
                    const hit = categories.data?.find(c => c.name.toLowerCase() === d.category.trim().toLowerCase())

                    if (hit && hit.name !== d.category) set('category', hit.name)
                  }}
                  list={catList}
                />
                <datalist id={catList}>
                  {(categories.data ?? []).map(c => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </div>
              <TagInput value={d.tags} onChange={v => set('tags', v)} suggestions={(tags.data ?? []).map(t => t.name)} />
              <TextField name='post-author' label='Author' hint='The name shown on the post.' value={d.authorName} onChange={e => set('authorName', e.target.value)} />
              <label className='flex items-center gap-2'>
                <Switch checked={d.featured} onCheckedChange={c => set('featured', c)} aria-label='Feature this post' />
                <Text size='sm'>Feature at the top of the blog (the newest featured post leads)</Text>
              </label>
            </div>
            <div className='flex flex-col gap-3'>
              <ImageField
                name='post-cover'
                label='Cover image'
                hint='Shown on the post and in the blog list; used for link previews. 1200×630 works everywhere.'
                value={d.coverImageUrl}
                onChange={v => set('coverImageUrl', v)}
                onPickAlt={alt => !d.coverImageAlt && set('coverImageAlt', alt)}
                error={coverProblem ?? undefined}
              />
              <TextField name='post-cover-alt' label='Cover description (alt text)' value={d.coverImageAlt} onChange={e => set('coverImageAlt', e.target.value)} />
              {d.coverImageUrl && !coverProblem ? <img src={d.coverImageUrl} alt={d.coverImageAlt} className='blog-cover-preview' /> : <div className='blog-cover-preview blog-thumb-empty'>No cover image</div>}
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value='seo'>
          <div className='flex flex-col gap-3' style={{ maxInlineSize: 680 }}>
            <TextField
              name='post-slug'
              label='Address'
              hint={post.previousSlugs.length ? `Old addresses that redirect here: ${post.previousSlugs.map(s => `/blog/${s}`).join(', ')}` : live ? 'Changing it keeps the old address working as a redirect.' : 'Lowercase letters, digits and -.'}
              value={d.slug}
              onChange={e => set('slug', e.target.value.toLowerCase())}
              error={slugProblem ?? undefined}
            />
            <TextField name='post-seo-title' label='Search title' hint='Defaults to the title. Around 60 characters show in search results.' value={d.seoTitle} onChange={e => set('seoTitle', e.target.value)} />
            <Counter value={d.seoTitle} max={120} />
            <TextareaField name='post-seo-description' label='Search description' hint='Defaults to the excerpt. Around 155 characters show.' rows={3} value={d.seoDescription} onChange={e => set('seoDescription', e.target.value)} />
            <Counter value={d.seoDescription} max={300} />
            <div className='serp-preview' aria-label='Search result preview'>
              <div className='serp-url'>{SITE.replace(/^https?:\/\//, '')}/blog/{d.slug}</div>
              <div className='serp-title'>{(d.seoTitle || d.title).slice(0, 60)}</div>
              <div className='serp-desc'>{(d.seoDescription || d.excerpt || 'The start of the post.').slice(0, 155)}</div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value='publish'>
          <div className='flex flex-col gap-4' style={{ maxInlineSize: 560 }}>
            <Text size='sm'>
              {post.state === 'PUBLISHED' && `Published ${formatDate(post.publishedAt)}. Saved changes show on the site straight away.`}
              {post.state === 'SCHEDULED' && `Scheduled: goes live ${formatDate(post.publishedAt)} (within a minute of that time).`}
              {post.state === 'DRAFT' && 'A draft: only admins see it.'}
            </Text>
            <div className='flex items-end gap-2 flex-wrap'>
              <TextField name='post-schedule' label={post.state === 'DRAFT' ? 'Publish at a later time' : 'Change the publish date'} type='datetime-local' value={scheduleAt} min={localInput(new Date())} onChange={e => setScheduleAt(e.target.value)} />
              <Button variant='outline' disabled={!scheduleAt || dirty} loading={publish.isPending} onClick={() => onPublish(new Date(scheduleAt).toISOString()).then(() => setScheduleAt(''))}>
                {post.state === 'DRAFT' ? 'Schedule' : 'Set date'}
              </Button>
            </div>
            <Text size='xs' tone='muted'>
              Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). A past date publishes now, dated then.
            </Text>
            <div className='flex gap-3 flex-wrap'>
              {post.status === 'PUBLISHED' && (
                <Button variant='outline' onClick={() => setConfirm('unpublish')}>
                  Back to draft
                </Button>
              )}
              <Button variant='destructive' onClick={() => setConfirm('delete')}>
                Delete post
              </Button>
            </div>
          </div>
        </Tabs.Content>
      </Tabs>

      {confirm === 'unpublish' && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setConfirm(null)}
          title='Take this post off the blog?'
          description='It goes back to draft; its address answers 404 until you publish it again.'
          confirmLabel='Back to draft'
          requireReason={false}
          onConfirm={() => unpublish.mutateAsync(undefined as never).then(() => toast.success('Back to draft'))}
        />
      )}
      {confirm === 'delete' && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setConfirm(null)}
          title={`Delete "${post.title}"?`}
          description='The post is removed for good. Its categories and tags stay.'
          confirmLabel='Delete'
          destructive
          requireReason={false}
          onConfirm={() => platformService.deleteBlogPost(id).then(() => (toast.success('Deleted'), router.push('/blog')))}
        />
      )}
    </div>
  )
}
