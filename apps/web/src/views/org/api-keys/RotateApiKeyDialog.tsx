'use client'
import { useState } from 'react'

import { Alert, Button, Dialog } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'

type Props = {
  open: boolean
  onClose: () => void
  row: { name: string; id: string } // minimal key info for dialog, display only
  // Owns the single real rotate mutation call — see decision.md, 2026-09-10/11,
  // "Step 5b: fixed a double-rotation bug". This dialog no longer calls
  // useRotateApiKey itself; it only triggers the parent's mutation (already
  // bound to this row's keyId via closure) and waits for it to resolve
  // before closing.
  onConfirm: () => Promise<void>
}

export function RotateApiKeyDialog({ open, onClose, row, onConfirm }: Props) {
  const [isRotating, setIsRotating] = useState(false)

  const handleRotate = async () => {
    setIsRotating(true)

    try {
      await onConfirm()
      onClose()
    } catch {
      // No onError handling existed in the original implementation either —
      // preserved as-is, not introducing new error UX beyond this step's scope.
      // (The global MutationCache.onError handler in queryClient.ts already
      // toasts every mutation failure app-wide, this one included.)
    } finally {
      setIsRotating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && !isRotating && onClose()}>
      {/* Dialog.Portal is what actually gates rendering on `open` — see
          decision.md, 2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Rotate API key</Dialog.Title>
          <div className='flex flex-col gap-3'>
            <Alert variant='warning'>
              A new secret will be generated. The old secret remains valid during a grace period to allow migration.
            </Alert>
            <Typography variant='body2'>
              Rotating <strong>{row.name}</strong> will generate a new secret. You must update all services using the
              old secret before the grace period ends.
            </Typography>
          </div>
          <Dialog.Footer>
            <Button className='shrink-0' variant='secondary' onClick={onClose} disabled={isRotating}>
              Cancel
            </Button>
            {/* VhyxUI's Button has no 'warning' variant (unlike MUI's
                color='warning', used originally) — 'destructive' would
                overstate severity for a safe, grace-period-buffered action
                that isn't actually irreversible data loss like revoke is, so
                this uses the neutral 'primary' variant instead. */}
            <Button className='shrink-0' onClick={handleRotate} loading={isRotating}>
              Rotate key
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
