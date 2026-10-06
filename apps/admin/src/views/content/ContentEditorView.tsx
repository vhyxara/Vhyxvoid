'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Button, Grid, SelectField, Skeleton, Switch, Table, Tabs, Text, TextareaField, TextField, toast } from '@vhyxui/react'

import { usePlatformDetail, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/components/ui/format'
import { StructuredEditor } from './StructuredEditor'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:4000').replace(/\/$/, '')

function publicPath(kind: string, slug: string) {
  if (slug === 'home') return '/'
  if (kind === 'page') return `/p/${slug}`

  return `/${slug}`
}

export function ContentEditorView({ id }: { id: string }) {
  const router = useRouter()
  const { data: entry, isLoading, error } = usePlatformDetail('content', id, platformService.contentEntry)
  const [title, setTitle] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [data, setData] = useState<any>(null)
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'delete' | 'publish' | 'unpublish'>(null)

  useEffect(() => {
    if (!entry) return
    setTitle(entry.title)
    setSeoTitle(entry.seoTitle ?? '')
    setSeoDescription(entry.seoDescription ?? '')
    setData(entry.data)
    setJsonText(JSON.stringify(entry.data, null, 2))
  }, [entry])

  const save = usePlatformMutation(['content'], () =>
    platformService.saveContent(id, { title, data, seoTitle: seoTitle || null, seoDescription: seoDescription || null, expectedUpdatedAt: entry?.updatedAt })
  )
  const publish = usePlatformMutation(['content'], (note: string) => platformService.publishContent(id, note || undefined))
  const unpublish = usePlatformMutation(['content'], () => platformService.unpublishContent(id))
  const restore = usePlatformMutation(['content'], (revisionId: string) => platformService.restoreRevision(id, revisionId))

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (isLoading || !entry || data === null) return <Skeleton height='24rem' />

  const dirty =
    title !== entry.title ||
    (seoTitle || null) !== entry.seoTitle ||
    (seoDescription || null) !== entry.seoDescription ||
    JSON.stringify(data) !== JSON.stringify(entry.data)
  const unpublishedChanges = entry.status === 'PUBLISHED' && JSON.stringify(entry.data) !== JSON.stringify(entry.publishedData)

  const onSave = () =>
    save
      .mutateAsync(undefined as never)
      .then(() => toast.success('Draft saved'))
      .catch((e: any) => toast.danger(e.message))

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        eyebrow={<Link href='/content'>Website content</Link>}
        title={
          <span className='flex items-center gap-3 flex-wrap'>
            {entry.title} <StatusBadge status={entry.status} />
            {unpublishedChanges && <Text size='sm' tone='muted'>unpublished changes</Text>}
          </span>
        }
        description={`${publicPath(entry.kind, entry.slug)} · version ${entry.version}${entry.publishedAt ? ` · published ${formatDate(entry.publishedAt)}` : ''}`}
        actions={[
          <Button key='v' variant='ghost' onClick={() => window.open(`${SITE}${publicPath(entry.kind, entry.slug)}`, '_blank')}>
            View live ↗
          </Button>,
          <Button key='s' variant='outline' disabled={!dirty} loading={save.isPending} onClick={onSave}>
            Save draft
          </Button>,
          <Button key='p' disabled={dirty} onClick={() => setConfirm('publish')}>
            Publish
          </Button>
        ]}
      />
      {dirty && <Alert variant='info'>Save the draft before publishing.</Alert>}

      <Tabs defaultValue='content' variant='underline'>
        <Tabs.List>
          <Tabs.Trigger value='content'>Content</Tabs.Trigger>
          <Tabs.Trigger value='seo'>Title & SEO</Tabs.Trigger>
          <Tabs.Trigger value='history'>History ({entry.revisions.length})</Tabs.Trigger>
          <Tabs.Trigger value='danger'>Unpublish / delete</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value='content'>
          {entry.kind === 'page' ? (
            <Grid minChildWidth='24rem' gap={4}>
              <div className='flex flex-col gap-3'>
                <TextareaField name='body' label='Markdown' rows={24} value={data.body ?? ''} onChange={e => setData({ ...data, body: e.target.value })} style={{ fontFamily: 'var(--vhyx-font-mono, monospace)' }} />
                <label className='flex items-center gap-2'>
                  <Switch checked={!!data.showInFooter} onCheckedChange={c => setData({ ...data, showInFooter: c })} aria-label='Show in footer' />
                  <Text size='sm'>Link from the website footer</Text>
                </label>
                <SelectField
                  name='footerGroup'
                  label='Footer column'
                  size='sm'
                  value={data.footerGroup ?? 'company'}
                  onValueChange={v => setData({ ...data, footerGroup: v })}
                  options={[{ value: 'product', label: 'Product' }, { value: 'company', label: 'Company' }, { value: 'legal', label: 'Legal' }]}
                />
              </div>
              <Section title='Preview'>
                <article className='markdown-preview' style={{ maxBlockSize: '70vh', overflow: 'auto' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.body ?? ''}</ReactMarkdown>
                </article>
              </Section>
            </Grid>
          ) : (
            <div className='flex flex-col gap-3'>
              <label className='flex items-center gap-2'>
                <Switch
                  checked={jsonMode}
                  onCheckedChange={c => {
                    if (c) setJsonText(JSON.stringify(data, null, 2))
                    setJsonMode(c)
                    setJsonError(null)
                  }}
                  aria-label='Edit as JSON'
                />
                <Text size='sm'>Edit as JSON</Text>
              </label>
              {jsonMode ? (
                <>
                  <TextareaField
                    name='json'
                    label='JSON'
                    rows={28}
                    value={jsonText}
                    onChange={e => {
                      setJsonText(e.target.value)
                      try {
                        setData(JSON.parse(e.target.value))
                        setJsonError(null)
                      } catch (err: any) {
                        setJsonError(err.message)
                      }
                    }}
                    style={{ fontFamily: 'var(--vhyx-font-mono, monospace)' }}
                  />
                  {jsonError && <Alert variant='danger'>{jsonError}</Alert>}
                </>
              ) : (
                <StructuredEditor value={data} onChange={setData} />
              )}
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value='seo'>
          <div className='flex flex-col gap-3' style={{ maxInlineSize: 640 }}>
            <TextField name='title' label='Title' hint='Shown in the admin and as the page heading.' value={title} onChange={e => setTitle(e.target.value)} />
            <TextField name='seoTitle' label='Browser/search title' hint='Defaults to the title.' value={seoTitle} onChange={e => setSeoTitle(e.target.value)} />
            <TextareaField name='seoDescription' label='Search description' hint='Up to 300 characters.' rows={3} value={seoDescription} onChange={e => setSeoDescription(e.target.value)} />
          </div>
        </Tabs.Content>

        <Tabs.Content value='history'>
          <Table
            density='compact'
            data={entry.revisions as any}
            emptyState={<Text tone='muted'>Never published.</Text>}
            columns={[
              { key: 'version', header: 'Version' },
              { key: 'createdAt', header: 'Published', cell: (r: any) => formatDate(r.createdAt) },
              { key: 'note', header: 'Note' },
              {
                key: 'x',
                header: '',
                align: 'end',
                cell: (r: any) => (
                  <Button size='xs' variant='ghost' onClick={() => restore.mutateAsync(r.id).then(() => toast.success(`Version ${r.version} restored to the draft. Review and publish.`))}>
                    Restore to draft
                  </Button>
                )
              }
            ]}
          />
        </Tabs.Content>

        <Tabs.Content value='danger'>
          <div className='flex flex-wrap gap-3'>
            <Button variant='outline' disabled={entry.status !== 'PUBLISHED'} onClick={() => setConfirm('unpublish')}>
              Unpublish
            </Button>
            <Button variant='destructive' onClick={() => setConfirm('delete')}>
              Delete
            </Button>
          </div>
          <Text size='sm' tone='muted' className='mbs-2'>
            Built-in pages (home, pricing, terms, privacy) fall back to their default content when unpublished or deleted.
          </Text>
        </Tabs.Content>
      </Tabs>

      {confirm === 'publish' && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setConfirm(null)}
          title={`Publish "${entry.title}"?`}
          description='The website shows this version within a minute. The note is optional.'
          confirmLabel='Publish'
          requireReason={false}
          onConfirm={() => publish.mutateAsync('').then(() => toast.success('Published'))}
        />
      )}
      {confirm === 'unpublish' && (
        <ReasonDialog open onOpenChange={o => !o && setConfirm(null)} title='Unpublish?' description='The page goes back to draft.' confirmLabel='Unpublish' requireReason={false} onConfirm={() => unpublish.mutateAsync(undefined as never)} />
      )}
      {confirm === 'delete' && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setConfirm(null)}
          title={`Delete "${entry.title}"?`}
          description='The entry and its history are removed.'
          confirmLabel='Delete'
          destructive
          requireReason={false}
          onConfirm={() => platformService.deleteContent(id).then(() => router.push('/content'))}
        />
      )}
    </div>
  )
}
