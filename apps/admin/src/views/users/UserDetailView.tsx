'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Button, Grid, Skeleton, Table, Text, toast } from '@vhyxui/react'

import { usePlatformDetail, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import { KeyValue } from '@/components/ui/KeyValue'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, timeAgo } from '@/components/ui/format'
import { userStateBadge } from './UsersView'

type Pending = null | { kind: 'disable' | 'enable' | 'delete' | 'signout' | 'reset' | 'verify' | 'unlock' }

export function UserDetailView({ id }: { id: string }) {
  const router = useRouter()
  const { data: u, isLoading, error } = usePlatformDetail('users', id, platformService.user)
  const mutate = usePlatformMutation(['users', 'accounts'], (fn: () => Promise<unknown>) => fn())
  const [pending, setPending] = useState<Pending>(null)

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (isLoading || !u) return <Skeleton height='20rem' />

  const locked = !!u.lockedUntil && new Date(u.lockedUntil) > new Date()
  const deleted = !!u.deletedAt

  const actions: Record<NonNullable<Pending>['kind'], { title: string; description: string; confirm: string; destructive?: boolean; reason?: boolean; run: (reason: string) => Promise<unknown> }> = {
    disable: { title: 'Disable this user?', description: 'They are signed out everywhere and cannot sign in until re-enabled.', confirm: 'Disable', destructive: true, reason: true, run: r => platformService.updateUser(id, { status: false, reason: r }) },
    enable: { title: 'Enable this user?', description: 'They can sign in again.', confirm: 'Enable', run: () => platformService.updateUser(id, { status: true }) },
    verify: { title: 'Mark the email as verified?', description: 'Only do this when you have confirmed the address another way.', confirm: 'Mark verified', reason: true, run: r => platformService.updateUser(id, { isEmailVerified: true, reason: r }) },
    unlock: { title: 'Unlock sign-in?', description: 'Clears failed sign-in attempts.', confirm: 'Unlock', run: () => platformService.unlockUser(id) },
    signout: { title: 'Sign out everywhere?', description: 'Every session and access token is revoked now.', confirm: 'Sign out', run: () => platformService.signOutUser(id) },
    reset: { title: 'Send a password reset email?', description: `A reset link goes to ${u.email}.`, confirm: 'Send email', run: () => platformService.sendPasswordReset(id) },
    delete: {
      title: 'Delete this user?',
      description: 'Personal data is erased, sessions and their API keys are revoked, and their personal workspace is closed. This cannot be undone.',
      confirm: 'Delete user',
      destructive: true,
      reason: true,
      run: r => platformService.deleteUser(id, r).then(() => router.push('/users'))
    }
  }

  const a = pending ? actions[pending.kind] : null

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        eyebrow={<Link href='/users'>Users</Link>}
        title={
          <span className='flex items-center gap-3 flex-wrap'>
            {u.email} {userStateBadge({ ...u, locked })}
          </span>
        }
        description={`${`${u.firstName} ${u.lastName}`.trim() || 'No name'} · signed up ${formatDate(u.createdAt, false)}`}
        actions={
          deleted
            ? []
            : [
                <Button key='reset' variant='outline' onClick={() => setPending({ kind: 'reset' })}>
                  Send password reset
                </Button>,
                <Button key='so' variant='outline' onClick={() => setPending({ kind: 'signout' })}>
                  Sign out everywhere
                </Button>,
                u.status ? (
                  <Button key='dis' variant='ghost' onClick={() => setPending({ kind: 'disable' })}>
                    Disable
                  </Button>
                ) : (
                  <Button key='en' onClick={() => setPending({ kind: 'enable' })}>
                    Enable
                  </Button>
                ),
                <Button key='del' variant='destructive' onClick={() => setPending({ kind: 'delete' })}>
                  Delete
                </Button>
              ]
        }
      />

      {!deleted && (locked || !u.isEmailVerified) && (
        <Alert variant='info'>
          <div className='flex flex-wrap items-center gap-3'>
            {locked && (
              <>
                <span>Sign-in is locked after failed attempts (until {formatDate(u.lockedUntil)}).</span>
                <Button size='xs' variant='outline' onClick={() => setPending({ kind: 'unlock' })}>
                  Unlock
                </Button>
              </>
            )}
            {!u.isEmailVerified && (
              <>
                <span>The email address is not verified; the user cannot sign in yet.</span>
                <Button size='xs' variant='outline' onClick={() => setPending({ kind: 'verify' })}>
                  Mark verified
                </Button>
              </>
            )}
          </div>
        </Alert>
      )}

      <Grid minChildWidth='22rem' gap={4}>
        <Section title='Profile'>
          <KeyValue
            items={[
              ['User id', <code key='i'>{u.id}</code>],
              ['Failed sign-ins', String(u.failedLoginAttempts)],
              ['API keys created', String(u.keysCreated)],
              ['Feedback sent', String(u.feedbackCount)],
              ['Active sessions', String(u.activeSessions.length)]
            ]}
          />
        </Section>
        <Section title='Workspaces'>
          <Table
            density='compact'
            data={u.accounts as any}
            rowKey={(r: any) => r.account.id}
            emptyState={<Text tone='muted'>No workspaces.</Text>}
            columns={[
              { key: 'account', header: 'Account', cell: (r: any) => <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> },
              { key: 'role', header: 'Role', cell: (r: any) => r.role.name },
              { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.account.status} /> }
            ]}
          />
        </Section>
      </Grid>

      <Section title='Active sessions'>
        <Table
          density='compact'
          data={u.activeSessions as any}
          emptyState={<Text tone='muted'>Not signed in anywhere.</Text>}
          columns={[
            { key: 'createdAt', header: 'Started', cell: (r: any) => timeAgo(r.createdAt) },
            { key: 'ipAddress', header: 'IP' },
            { key: 'userAgent', header: 'Device', cell: (r: any) => <Text size='xs'>{r.userAgent}</Text> },
            { key: 'expiresAt', header: 'Expires', cell: (r: any) => formatDate(r.expiresAt, false) }
          ]}
        />
      </Section>

      <Section title='Recent activity'>
        <Table
          density='compact'
          data={u.recentActivity as any}
          emptyState={<Text tone='muted'>No recorded activity.</Text>}
          columns={[
            { key: 'createdAt', header: 'When', cell: (r: any) => formatDate(r.createdAt) },
            { key: 'action', header: 'Action', cell: (r: any) => <code>{r.action}</code> },
            { key: 'resourceType', header: 'On' },
            { key: 'ipAddress', header: 'IP' }
          ]}
        />
      </Section>

      {a && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setPending(null)}
          title={a.title}
          description={a.description}
          confirmLabel={a.confirm}
          destructive={a.destructive}
          requireReason={!!a.reason}
          onConfirm={reason => mutate.mutateAsync(() => a.run(reason)).then(() => toast.success('Done'))}
        />
      )}
    </div>
  )
}
