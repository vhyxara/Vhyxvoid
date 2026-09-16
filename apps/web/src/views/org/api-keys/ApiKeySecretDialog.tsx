'use client'
import { useState } from 'react'

import { Alert, Button, Checkbox, Dialog, Tooltip } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'

type Props = {
  open: boolean
  onClose: () => void
  secret: string
  keyId: string
  name: string
  graceEndsAt?: string // rotation only
  isRotation?: boolean
}

export function ApiKeySecretDialog({ open, onClose, secret, keyId, name, graceEndsAt, isRotation = false }: Props) {
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    if (!confirmed) return // force confirmation before closing
    setConfirmed(false)
    setCopied(false)
    onClose()
  }

  return (
    // VhyxUI's Dialog has no disableEscapeKeyDown/backdrop-click-block prop
    // (unlike MUI's) — both Escape and overlay-click route through
    // onOpenChange(false), so gating there on `confirmed` achieves the same
    // "cannot dismiss without confirming" behavior the original MUI dialog
    // had via disableEscapeKeyDown + an empty onClose. See decision.md,
    // 2026-09-10/11, "Step 5b".
    <Dialog open={open} onOpenChange={next => !next && handleClose()}>
      {/* Dialog.Portal is what actually gates rendering on `open` — see
          decision.md, 2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
        <Dialog.Title>
          {isRotation ? '🔄 Key rotated — save your new secret' : '🎉 API key created — save your secret'}
        </Dialog.Title>

        <div className='flex flex-col gap-4'>
          <Alert variant='warning' icon={<i className='tabler-alert-triangle' />}>
            <Typography variant='body2'>This is the only time the secret will be shown.</Typography>
            <Typography variant='body2'>Copy it now and store it securely. It cannot be retrieved later.</Typography>
          </Alert>

          {/* Key info */}
          <div>
            <Typography variant='caption'>Key name</Typography>
            <Typography variant='body2'>{name}</Typography>
            {keyId && (
              <>
                <Typography variant='caption' className='mt-2' style={{ display: 'block' }}>
                  Key ID
                </Typography>
                <Typography variant='body2' style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {keyId}
                </Typography>
              </>
            )}
          </div>

          {/* Secret reveal */}
          <div>
            <Typography variant='caption' className='mb-1' style={{ display: 'block' }}>
              Secret key
            </Typography>
            <div
              className='flex items-center gap-2 p-3 rounded-lg border'
              style={{
                backgroundColor: 'var(--vhyx-color-bg-muted)',
                borderColor: 'var(--vhyx-color-border)',
                wordBreak: 'break-all'
              }}
            >
              <Typography
                variant='body2'
                className='flex-1'
                style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}
              >
                {secret}
              </Typography>
              <Tooltip content={copied ? 'Copied!' : 'Copy secret'}>
                <Button
                  variant='ghost'
                  size='sm'
                  iconOnly
                  aria-label='Copy secret'
                  onClick={handleCopy}
                  icon={
                    <i
                      className={copied ? 'tabler-check' : 'tabler-copy'}
                      style={copied ? { color: 'var(--vhyx-color-success)' } : undefined}
                    />
                  }
                />
              </Tooltip>
            </div>
          </div>

          {/* Grace period note for rotation */}
          {isRotation && graceEndsAt && (
            <Alert variant='info'>
              Your old key will continue working until <strong>{new Date(graceEndsAt).toLocaleString()}</strong> to
              allow migration.
            </Alert>
          )}

          {/* Confirmation checkbox — prevents accidental close */}
          <div className='flex items-center gap-2'>
            <Checkbox checked={confirmed} onCheckedChange={c => setConfirmed(c === true)} aria-labelledby='secret-confirm-label' />
            <Typography
              id='secret-confirm-label'
              variant='body2'
              onClick={() => setConfirmed(c => !c)}
              style={{ cursor: 'pointer' }}
            >
              I have copied and stored the secret key safely
            </Typography>
          </div>
        </div>

        <Dialog.Footer>
          <Button className='shrink-0' onClick={handleClose} disabled={!confirmed} style={{ width: '100%' }}>
            Done
          </Button>
        </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
