'use client'

import { useState } from 'react'

import { Alert, Button, Dialog, TextareaField } from '@vhyxui/react'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel: string
  destructive?: boolean
  /** Ask for a reason (kept in the audit log). */
  requireReason?: boolean
  onConfirm: (reason: string) => Promise<unknown>
}

/** Confirmation for consequential admin actions; the reason goes to the audit log. */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, destructive, requireReason = true, onConfirm }: Props) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = !requireReason || reason.trim().length >= 3

  const close = (next: boolean) => {
    if (!next) {
      setReason('')
      setError(null)
    }
    onOpenChange(next)
  }

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      close(false)
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{title}</Dialog.Title>
          {description && <Dialog.Description>{description}</Dialog.Description>}
          <div className='flex flex-col gap-3 mbs-3'>
            {requireReason && (
              <TextareaField name='reason'
                label='Reason'
                hint='Recorded in the admin audit log.'
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                autoFocus
              />
            )}
            {error && <Alert variant='danger'>{error}</Alert>}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={destructive ? 'destructive' : 'primary'} disabled={!valid} loading={busy} onClick={confirm}>
              {confirmLabel}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
