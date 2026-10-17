'use client'

// The media library: a grid of uploaded images with search and drag-and-drop
// upload. On the Media screen a click opens the image's details (alt text,
// name, address, where it is used, delete); inside the picker a click chooses it.
import { useEffect, useRef, useState } from 'react'

import { Alert, Button, Input, Pagination, Skeleton, Text } from '@vhyxui/react'

import { usePlatformList } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { MediaAsset } from '@/api/platform/types'

export const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
export const MEDIA_AREAS = ['media']

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** Files a visitor dropped or picked that can be uploaded, and the ones that can't (with why). */
export function sortFiles(files: File[]) {
  const ok: File[] = []
  const refused: string[] = []

  for (const f of files) {
    if (!MEDIA_ACCEPT.split(',').includes(f.type)) refused.push(`${f.name}: use PNG, JPEG, WebP, GIF or AVIF${f.type === 'image/svg+xml' ? ' (SVG can carry scripts)' : ''}`)
    else if (f.size > 10 * 1024 * 1024) refused.push(`${f.name}: larger than 10 MB`)
    else ok.push(f)
  }

  return { ok, refused }
}

type Upload = { name: string; state: 'waiting' | 'uploading' | 'done' | 'failed'; error?: string }

export function MediaLibrary({ onPick, selectedId, onOpen }: { onPick?: (a: MediaAsset) => void; selectedId?: string; onOpen?: (a: MediaAsset) => void }) {
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [uploads, setUploads] = useState<Upload[]>([])
  const [refused, setRefused] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const query = usePlatformList('media', platformService.media, { page, limit: 24, ...(search ? { search } : {}) })

  useEffect(() => {
    const t = setTimeout(() => (setSearch(searchInput.trim()), setPage(1)), 300)

    return () => clearTimeout(t)
  }, [searchInput])

  const upload = async (files: File[]) => {
    const { ok, refused: no } = sortFiles(files)

    setRefused(no)
    if (!ok.length) return
    setUploads(ok.map(f => ({ name: f.name, state: 'waiting' })))
    let last: MediaAsset | null = null

    // One at a time: large photos are processed on the server.
    for (let i = 0; i < ok.length; i++) {
      setUploads(u => u.map((x, j) => (j === i ? { ...x, state: 'uploading' } : x)))

      try {
        last = await platformService.uploadMedia(ok[i])
        setUploads(u => u.map((x, j) => (j === i ? { ...x, state: 'done' } : x)))
      } catch (e) {
        setUploads(u => u.map((x, j) => (j === i ? { ...x, state: 'failed', error: (e as Error).message } : x)))
      }
    }

    setPage(1)
    await query.refetch()
    // A single upload in the picker is chosen straight away.
    if (onPick && ok.length === 1 && last) onPick(last)
    setTimeout(() => setUploads(u => u.filter(x => x.state === 'failed')), 2500)
  }

  const items = query.data?.items ?? []
  const busy = uploads.some(u => u.state === 'uploading' || u.state === 'waiting')

  return (
    <div className='flex flex-col gap-3'>
      <div
        className='media-drop'
        data-dragging={dragging || undefined}
        onDragOver={e => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault()
          setDragging(false)
          void upload(Array.from(e.dataTransfer.files))
        }}
      >
        <Text size='sm'>
          Drop images here, or{' '}
          <button type='button' className='media-link' onClick={() => input.current?.click()} disabled={busy}>
            choose files
          </button>
          . PNG, JPEG, WebP, GIF or AVIF, up to 10 MB. Photos are turned upright, stripped of location data and scaled to at most 2400 px.
        </Text>
        <input
          ref={input}
          type='file'
          accept={MEDIA_ACCEPT}
          multiple
          hidden
          aria-label='Upload images'
          onChange={e => {
            void upload(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      {(uploads.length > 0 || refused.length > 0) && (
        <ul className='media-uploads'>
          {uploads.map((u, i) => (
            <li key={i} data-state={u.state}>
              {u.state === 'uploading' ? '⏳' : u.state === 'done' ? '✓' : u.state === 'failed' ? '✕' : '·'} {u.name}
              {u.error ? ` — ${u.error}` : ''}
            </li>
          ))}
          {refused.map(r => (
            <li key={r} data-state='failed'>
              ✕ {r}
            </li>
          ))}
        </ul>
      )}
      <Input aria-label='Search images' placeholder='Search by name or description' value={searchInput} onChange={e => setSearchInput(e.target.value)} size='sm' />
      {query.error ? (
        <Alert variant='danger'>{(query.error as Error).message}</Alert>
      ) : query.isLoading ? (
        <Skeleton height='14rem' />
      ) : items.length === 0 ? (
        <Text tone='muted'>{search ? 'No image matches.' : 'No images yet. Upload the first one above.'}</Text>
      ) : (
        <ul className='media-grid'>
          {items.map(a => (
            <li key={a.id}>
              <button
                type='button'
                className='media-tile'
                data-selected={a.id === selectedId || undefined}
                onClick={() => (onPick ? onPick(a) : onOpen?.(a))}
                title={`${a.filename} · ${a.width}×${a.height} · ${formatBytes(a.size)}`}
              >
                <img src={a.thumbUrl} alt={a.alt} loading='lazy' />
                <span className='media-tile-name'>{a.filename}</span>
                {!a.alt && (
                  <span className='media-tile-flag' title='No description (alt text)'>
                    alt
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(query.data?.meta.totalPages ?? 1) > 1 && (
        <div className='flex justify-center'>
          <Pagination page={page} pageCount={query.data!.meta.totalPages} onPageChange={setPage} size='sm' />
        </div>
      )}
      {onPick && (
        <Button variant='ghost' size='sm' onClick={() => input.current?.click()} disabled={busy} style={{ alignSelf: 'flex-start' }}>
          Upload…
        </Button>
      )}
    </div>
  )
}
