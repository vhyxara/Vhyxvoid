'use client'

// The Media screen: the library, and an image's details (description, name,
// address, where it is used, delete).
import { useEffect, useState } from 'react'

import Link from 'next/link'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Button, Dialog, Text, TextareaField, TextField, toast } from '@vhyxui/react'
import { useQuery } from '@tanstack/react-query'

import { usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { MediaAsset } from '@/api/platform/types'
import { formatDate } from '@/components/ui/format'
import { MEDIA_AREAS, MediaLibrary, formatBytes } from './MediaLibrary'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:4000').replace(/\/$/, '')

function Details({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const [alt, setAlt] = useState(asset.alt)
  const [filename, setFilename] = useState(asset.filename.replace(/\.[a-z0-9]+$/, ''))
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usage = useQuery({ queryKey: ['platform', 'media', 'usage', asset.id], queryFn: () => platformService.mediaUsage(asset.id) })
  const save = usePlatformMutation(MEDIA_AREAS, () => platformService.updateMedia(asset.id, { alt, filename }))
  const remove = usePlatformMutation(MEDIA_AREAS, (force: boolean) => platformService.deleteMedia(asset.id, force))
  const used = usage.data ?? []
  const changed = alt !== asset.alt || filename !== asset.filename.replace(/\.[a-z0-9]+$/, '')

  useEffect(() => setConfirming(false), [asset.id])

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ maxInlineSize: 900, inlineSize: 'calc(100vw - 32px)' }}>
          <Dialog.Title>{asset.filename}</Dialog.Title>
          <Dialog.Description>
            {asset.width}×{asset.height} · {formatBytes(asset.size)} · {asset.mime.replace('image/', '').toUpperCase()} · uploaded {formatDate(asset.createdAt)}
          </Dialog.Description>
          <div className='media-details mbs-3'>
            <a href={asset.url} target='_blank' rel='noreferrer' className='media-preview'>
              <img src={asset.url} alt={asset.alt} />
            </a>
            <div className='flex flex-col gap-3' style={{ minWidth: 0 }}>
              <TextareaField
                name='media-alt'
                label='Description (alt text)'
                hint='What the image shows, for screen readers and search engines. Filled in for you when you choose this image.'
                rows={3}
                maxLength={300}
                value={alt}
                onChange={e => setAlt(e.target.value)}
              />
              <TextField name='media-filename' label='File name' hint='Part of the address; the old address keeps working.' value={filename} onChange={e => setFilename(e.target.value)} />
              <div className='flex flex-col gap-1'>
                <Text size='sm' weight='medium'>
                  Address
                </Text>
                <div className='media-address'>
                  <code>{asset.url}</code>
                  <Button size='xs' variant='outline' onClick={() => navigator.clipboard.writeText(asset.url).then(() => toast.success('Copied'))}>
                    Copy
                  </Button>
                </div>
                <Text size='xs' tone='muted'>
                  On the website: {SITE}
                  {asset.url}
                </Text>
              </div>
              <div className='flex flex-col gap-1'>
                <Text size='sm' weight='medium'>
                  Used in
                </Text>
                {usage.isLoading ? (
                  <Text size='sm' tone='muted'>
                    Checking…
                  </Text>
                ) : used.length ? (
                  <ul className='media-usage'>
                    {used.map((u, i) => (
                      <li key={i}>
                        <Text size='xs' tone='muted'>
                          {u.kind}
                        </Text>{' '}
                        <Link href={u.href}>{u.label}</Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Text size='sm' tone='muted'>
                    Not used anywhere yet.
                  </Text>
                )}
              </div>
              {error && <Alert variant='danger'>{error}</Alert>}
            </div>
          </div>
          <Dialog.Footer>
            {confirming ? (
              <>
                <Text size='sm' tone='danger'>
                  {used.length ? `Used in ${used.length} place(s): those will show a broken image.` : 'Delete this image for good?'}
                </Text>
                <Button variant='secondary' onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
                <Button
                  variant='destructive'
                  loading={remove.isPending}
                  onClick={() =>
                    remove
                      .mutateAsync(used.length > 0)
                      .then(() => (toast.success('Deleted'), onClose()))
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Delete
                </Button>
              </>
            ) : (
              <>
                <Button variant='ghost' onClick={() => setConfirming(true)}>
                  Delete…
                </Button>
                <Button variant='secondary' onClick={onClose}>
                  Close
                </Button>
                <Button
                  disabled={!changed || !filename.trim()}
                  loading={save.isPending}
                  onClick={() =>
                    save
                      .mutateAsync(undefined)
                      .then(() => (toast.success('Saved'), onClose()))
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Save
                </Button>
              </>
            )}
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export function MediaView() {
  const [open, setOpen] = useState<MediaAsset | null>(null)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Media'
        description='Images for blog posts, pages and link previews. Choose them from any image field with "Choose…", or from the image button in the editor.'
      />
      <MediaLibrary onOpen={setOpen} />
      {open && <Details key={open.id} asset={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
