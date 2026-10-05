'use client'

import { useState } from 'react'

import { Alert, Button, Card, Text, TextField, toast } from '@vhyxui/react'

import { useAdminAuthStore } from '@/api/domain/auth/auth.store'
import { platformService } from '@/api/platform/service'

/**
 * Super admins can set another admin's password (e.g. a forgotten one). The
 * admin is signed out everywhere. Hidden for everyone else and for yourself
 * (use Change password in the account menu).
 */
export function SetAdminPasswordCard({ adminId }: { adminId: string }) {
  const me = useAdminAuthStore(s => s.admin)
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!me?.isSuperAdmin || me.id === adminId) return null

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await platformService.setAdminPassword(adminId, pw)
      toast.success('Password set. They have been signed out everywhere.')
      setPw('')
      setConfirm('')
    } catch (e: any) {
      setError(e?.message ?? 'Could not set the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant='outline' padding='md'>
      <div className='flex flex-col gap-3' style={{ maxInlineSize: 520 }}>
        <div>
          <Text weight='medium'>Set password</Text>
          <Text size='sm' tone='muted'>
            For an admin who lost theirs. Share it with them securely; they can change it from their account menu.
          </Text>
        </div>
        <TextField name='new-password' label='New password' type='password' autoComplete='new-password' hint='At least 12 characters.' value={pw} onChange={e => setPw(e.target.value)} />
        <TextField name='confirm-password' label='Confirm' type='password' autoComplete='new-password' value={confirm} onChange={e => setConfirm(e.target.value)} error={confirm && confirm !== pw ? 'The passwords differ.' : undefined} />
        {error && <Alert variant='danger'>{error}</Alert>}
        <div>
          <Button variant='outline' loading={busy} disabled={pw.length < 12 || pw !== confirm} onClick={submit}>
            Set password
          </Button>
        </div>
      </div>
    </Card>
  )
}
