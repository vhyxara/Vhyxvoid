'use client'

// Choosing an image from the media library (or uploading one) for a field:
// MediaPickerDialog on its own, or ImageField, a text field for an image
// address with a "Choose…" button and a preview.
import { useState } from 'react'

import { Button, Dialog, TextField } from '@vhyxui/react'

import type { MediaAsset } from '@/api/platform/types'
import { MediaLibrary } from './MediaLibrary'

export function MediaPickerDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (a: MediaAsset) => void }) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ maxInlineSize: 960, inlineSize: 'calc(100vw - 32px)', maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>Choose an image</Dialog.Title>
          <Dialog.Description>Pick one from the media library, or upload a new one: it is chosen as soon as it is uploaded.</Dialog.Description>
          <div className='mbs-3'>
            <MediaLibrary
              onPick={a => {
                onPick(a)
                onClose()
              }}
            />
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

/**
 * An image address field: type a URL or a site path, or choose from the
 * library. `onPickAlt` receives the chosen image's description, so a form
 * can fill its alt text field when it is empty.
 */
export function ImageField({
  name,
  label,
  value,
  onChange,
  onPickAlt,
  hint,
  error,
  placeholder = 'https://… or choose from the library'
}: {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  onPickAlt?: (alt: string) => void
  hint?: string
  error?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className='image-field'>
      <div className='image-field-row'>
        <TextField name={name} label={label} placeholder={placeholder} hint={hint} error={error} value={value} onChange={e => onChange(e.target.value)} />
        <Button type='button' variant='outline' onClick={() => setOpen(true)}>
          Choose…
        </Button>
      </div>
      <MediaPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        onPick={a => {
          onChange(a.url)
          if (a.alt) onPickAlt?.(a.alt)
        }}
      />
    </div>
  )
}
