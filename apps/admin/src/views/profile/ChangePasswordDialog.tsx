'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { Alert, Button, Dialog, TextField, toast } from '@vhyxui/react'

import { adminAuthService } from '@/api/infrastructure/auth.service'
import { useAdminAuthStore } from '@/api/domain/auth/auth.store'

/** Change your own admin password; every session (this one included) is signed out. */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const problem =
    next.length > 0 && next.length < 12 ? 'Use at least 12 characters.' : confirm && confirm !== next ? 'The two new passwords differ.' : null

  const reset = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await adminAuthService.changePassword({ currentPassword: current, newPassword: next })
      toast.success('Password changed. Sign in with your new password.')
      useAdminAuthStore.getState().clearSession()
      router.replace('/login')
    } catch (e: any) {
      setError(e?.message ?? 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) {
          reset()
          onClose()
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Change password</Dialog.Title>
          <Dialog.Description>You will be signed out of every device, including this one.</Dialog.Description>
          <div className='flex flex-col gap-3 mbs-3'>
            <TextField name='current-password' label='Current password' type='password' autoComplete='current-password' value={current} onChange={e => setCurrent(e.target.value)} />
            <TextField name='new-password' label='New password' type='password' autoComplete='new-password' hint='At least 12 characters.' value={next} onChange={e => setNext(e.target.value)} />
            <TextField name='confirm-new-password' label='Confirm new password' type='password' autoComplete='new-password' value={confirm} onChange={e => setConfirm(e.target.value)} error={problem ?? undefined} />
            {error && <Alert variant='danger'>{error}</Alert>}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button loading={busy} disabled={!current || next.length < 12 || next !== confirm} onClick={submit}>
              Change password
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
