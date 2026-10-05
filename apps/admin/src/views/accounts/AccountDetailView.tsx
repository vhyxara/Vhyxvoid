'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Badge, Button, Grid, Skeleton, Table, Tabs, Text, TextareaField, toast } from '@vhyxui/react'

import { usePlatformDetail, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import { KeyValue } from '@/components/ui/KeyValue'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatLimit, formatMoney, formatNumber, timeAgo } from '@/components/ui/format'
import { LimitOverridesEditor } from './LimitOverridesEditor'

type Action = null | 'SUSPENDED' | 'RESTRICTED' | 'ACTIVE' | 'delete' | { revokeKey: string } | { disconnect: string }

export function AccountDetailView({ id }: { id: string }) {
  const router = useRouter()
  const { data: a, isLoading, error } = usePlatformDetail('accounts', id, platformService.account)
  const update = usePlatformMutation(['accounts', 'overview'], (body: Record<string, unknown>) => platformService.updateAccount(id, body))
  const [action, setAction] = useState<Action>(null)
  const [notes, setNotes] = useState('')

  useEffect(() => setNotes(a?.adminNotes ?? ''), [a?.adminNotes])

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (isLoading || !a) return <Skeleton height='20rem' />

  const owner = a.members.find(m => m.roleLevel >= 100)
  const sub = a.subscriptions[0]
  const active = a.status === 'ACTIVE' || a.status === 'PAST_DUE'

  const dialog = (() => {
    if (!action) return null
    if (action === 'delete') {
      return {
        title: `Delete ${a.name}?`,
        description: 'The account is closed: its API keys are revoked, live tunnels are disconnected and pending invitations are cancelled. Data is kept for billing and audit.',
        confirm: 'Delete account',
        destructive: true,
        run: (reason: string) => platformService.deleteAccount(id, reason).then(() => router.push('/accounts'))
      }
    }
    if (typeof action === 'object' && 'revokeKey' in action) {
      return { title: 'Revoke this API key?', description: 'Agents using it are disconnected within a minute.', confirm: 'Revoke key', destructive: true, run: (r: string) => platformService.revokeApiKey(action.revokeKey, r) }
    }
    if (typeof action === 'object' && 'disconnect' in action) {
      return { title: 'Disconnect this agent?', description: 'The agent stops and does not reconnect by itself.', confirm: 'Disconnect', destructive: true, run: (r: string) => platformService.disconnectAgent(action.disconnect, r) }
    }
    const verb = action === 'ACTIVE' ? 'Reactivate' : action === 'SUSPENDED' ? 'Suspend' : 'Restrict'
    return {
      title: `${verb} ${a.name}?`,
      description:
        action === 'ACTIVE'
          ? 'Tunnels and API keys work again.'
          : 'Its agents are disconnected now and refused on reconnect. Members can still sign in and see billing.',
      confirm: verb,
      destructive: action !== 'ACTIVE',
      requireReason: action !== 'ACTIVE',
      run: (reason: string) => update.mutateAsync({ status: action, statusReason: reason || undefined }).then(r => toast.success(`${verb}d. ${r.disconnectedAgents ? `${r.disconnectedAgents} agent(s) disconnected.` : ''}`))
    }
  })()

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        eyebrow={<Link href='/accounts'>Accounts</Link>}
        title={
          <span className='flex items-center gap-3 flex-wrap'>
            {a.name} <StatusBadge status={a.status} />
            <Badge variant='outline' size='sm'>
              {a.type === 'PERSONAL' ? 'Personal' : 'Organization'}
            </Badge>
          </span>
        }
        description={a.slug ? `${a.slug} · created ${formatDate(a.createdAt, false)}` : undefined}
        actions={[
          active ? (
            <Button key='s' variant='outline' onClick={() => setAction('SUSPENDED')}>
              Suspend
            </Button>
          ) : a.status !== 'DELETED' ? (
            <Button key='a' onClick={() => setAction('ACTIVE')}>
              Reactivate
            </Button>
          ) : (
            <span key='x' />
          ),
          a.status === 'ACTIVE' ? (
            <Button key='r' variant='ghost' onClick={() => setAction('RESTRICTED')}>
              Restrict
            </Button>
          ) : (
            <span key='y' />
          ),
          a.status !== 'DELETED' ? (
            <Button key='d' variant='destructive' onClick={() => setAction('delete')}>
              Delete
            </Button>
          ) : (
            <span key='z' />
          )
        ]}
      />

      {a.statusReason && a.status !== 'ACTIVE' && (
        <Alert variant='warning' title={`Why it is ${a.status.toLowerCase()}`}>
          {a.statusReason}
        </Alert>
      )}

      <Grid minChildWidth='19rem' gap={4}>
        <Section title='Overview'>
          <KeyValue
            items={[
              ['Owner', owner ? <Link href={`/users/${owner.user.id}`}>{owner.user.email}</Link> : '—'],
              ['Plan', sub ? `${sub.plan} (${sub.status.toLowerCase()})` : 'FREE'],
              ['Renews / ends', sub ? formatDate(sub.currentPeriodEnd, false) : '—'],
              ['Grace ends', a.graceEndsAt ? formatDate(a.graceEndsAt) : '—'],
              ['Requests this month', formatNumber(a.usage.requestsThisMonth)],
              ['Stripe customer', a.stripeCustomerId ?? '—'],
              ['Account id', <code key='i'>{a.id}</code>]
            ]}
          />
        </Section>
        <Section title='Effective limits' description='Built-in plan, then admin overrides.'>
          <KeyValue
            items={(['maxAgents', 'maxMembers', 'maxApiKeys', 'maxRequestsPerMonth', 'rateLimitPerMinute', 'publicPathRateLimitPerMinute'] as const).map(
              k => [k, formatLimit(a.limits[k])] as [string, string]
            )}
          />
        </Section>
        <Section
          title='Admin notes'
          description='Only admins see these.'
          actions={
            <Button size='sm' variant='outline' loading={update.isPending} disabled={notes === (a.adminNotes ?? '')} onClick={() => update.mutateAsync({ adminNotes: notes || null }).then(() => toast.success('Notes saved'))}>
              Save
            </Button>
          }
        >
          <TextareaField name='notes' label='Notes' value={notes} onChange={e => setNotes(e.target.value)} rows={6} />
        </Section>
      </Grid>

      <Tabs defaultValue='members' variant='underline'>
        <Tabs.List>
          <Tabs.Trigger value='members'>Members ({a.members.length})</Tabs.Trigger>
          <Tabs.Trigger value='keys'>API keys ({a.apiKeys.length})</Tabs.Trigger>
          <Tabs.Trigger value='tunnels'>Tunnels</Tabs.Trigger>
          <Tabs.Trigger value='billing'>Billing</Tabs.Trigger>
          <Tabs.Trigger value='limits'>Limit overrides</Tabs.Trigger>
          <Tabs.Trigger value='security'>Security events</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value='members'>
          <Table
            density='compact'
            data={a.members as any}
            rowKey={(r: any) => r.user.id}
            columns={[
              { key: 'user', header: 'User', cell: (r: any) => <Link href={`/users/${r.user.id}`}>{r.user.email}</Link> },
              { key: 'name', header: 'Name', cell: (r: any) => `${r.user.firstName} ${r.user.lastName}`.trim() || '—' },
              { key: 'role', header: 'Role', cell: (r: any) => r.role.name },
              { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.user.status ? 'ACTIVE' : 'SUSPENDED'} label={r.user.status ? 'Active' : 'Disabled'} /> },
              { key: 'since', header: 'Member since', cell: (r: any) => formatDate(r.createdAt, false) }
            ]}
          />
        </Tabs.Content>

        <Tabs.Content value='keys'>
          <Table
            density='compact'
            data={a.apiKeys as any}
            emptyState={<Text tone='muted'>No API keys.</Text>}
            columns={[
              { key: 'name', header: 'Name' },
              { key: 'keyId', header: 'Key id', cell: (r: any) => <code>{r.keyId}</code> },
              { key: 'environment', header: 'Env' },
              { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
              { key: 'lastUsedAt', header: 'Last used', cell: (r: any) => timeAgo(r.lastUsedAt) },
              { key: 'createdBy', header: 'Created by', cell: (r: any) => r.createdBy?.email },
              {
                key: 'actions',
                header: '',
                align: 'end',
                cell: (r: any) =>
                  r.status === 'ACTIVE' ? (
                    <Button size='xs' variant='ghost' onClick={() => setAction({ revokeKey: r.id })}>
                      Revoke
                    </Button>
                  ) : null
              }
            ]}
          />
        </Tabs.Content>

        <Tabs.Content value='tunnels'>
          <div className='flex flex-col gap-4'>
            <Text weight='medium'>Live now</Text>
            {a.liveAgents === null ? (
              <Text tone='muted'>The hub is not reachable from the API, so live data is unavailable.</Text>
            ) : (
              <Table
                density='compact'
                data={a.liveAgents as any}
                rowKey={(r: any) => r.agentId}
                emptyState={<Text tone='muted'>No agent connected.</Text>}
                columns={[
                  { key: 'label', header: 'Label' },
                  { key: 'agentVersion', header: 'Agent' },
                  { key: 'ip', header: 'IP' },
                  { key: 'connectedAt', header: 'Connected', cell: (r: any) => timeAgo(r.connectedAt) },
                  {
                    key: 'x',
                    header: '',
                    align: 'end',
                    cell: (r: any) => (
                      <Button size='xs' variant='ghost' onClick={() => setAction({ disconnect: r.agentId })}>
                        Disconnect
                      </Button>
                    )
                  }
                ]}
              />
            )}
            <Text weight='medium'>Recent sessions</Text>
            <Table
              density='compact'
              data={a.tunnelSessions as any}
              emptyState={<Text tone='muted'>No sessions yet.</Text>}
              columns={[
                { key: 'label', header: 'Label' },
                { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
                { key: 'connectedAt', header: 'Connected', cell: (r: any) => formatDate(r.connectedAt) },
                { key: 'disconnectedAt', header: 'Disconnected', cell: (r: any) => formatDate(r.disconnectedAt) },
                { key: 'v', header: 'Agent', cell: (r: any) => r.metadata?.agentVersion ?? '—' }
              ]}
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value='billing'>
          <div className='flex flex-col gap-4'>
            <Table
              density='compact'
              data={a.subscriptions as any}
              emptyState={<Text tone='muted'>Never subscribed.</Text>}
              columns={[
                { key: 'plan', header: 'Plan' },
                { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
                { key: 'currentPeriodEnd', header: 'Period end', cell: (r: any) => formatDate(r.currentPeriodEnd, false) },
                { key: 'cancelAtPeriodEnd', header: 'Cancels', cell: (r: any) => (r.cancelAtPeriodEnd ? 'at period end' : '—') },
                { key: 'stripeSubscriptionId', header: 'Stripe', cell: (r: any) => <code>{r.stripeSubscriptionId}</code> }
              ]}
            />
            <Table
              density='compact'
              data={a.invoices as any}
              emptyState={<Text tone='muted'>No invoices.</Text>}
              columns={[
                { key: 'createdAt', header: 'Date', cell: (r: any) => formatDate(r.createdAt, false) },
                { key: 'amountDue', header: 'Amount', align: 'end', cell: (r: any) => formatMoney(r.amountDue, r.currency) },
                { key: 'status', header: 'Status', cell: (r: any) => <StatusBadge status={r.status} /> },
                { key: 'hostedInvoiceUrl', header: '', cell: (r: any) => (r.hostedInvoiceUrl ? <a href={r.hostedInvoiceUrl} target='_blank' rel='noreferrer'>View</a> : null) }
              ]}
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value='limits'>
          <LimitOverridesEditor
            value={a.limitOverrides}
            saving={update.isPending}
            onSave={limitOverrides => update.mutateAsync({ limitOverrides }).then(() => toast.success('Limits saved. They apply within a minute.'))}
          />
        </Tabs.Content>

        <Tabs.Content value='security'>
          <Table
            density='compact'
            data={a.securityEvents as any}
            emptyState={<Text tone='muted'>No security events.</Text>}
            columns={[
              { key: 'createdAt', header: 'When', cell: (r: any) => formatDate(r.createdAt) },
              { key: 'type', header: 'Type' },
              { key: 'ip', header: 'IP' },
              { key: 'reason', header: 'Reason' }
            ]}
          />
        </Tabs.Content>
      </Tabs>

      {dialog && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setAction(null)}
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirm}
          destructive={dialog.destructive}
          requireReason={'requireReason' in dialog ? dialog.requireReason : true}
          onConfirm={dialog.run}
        />
      )}
    </div>
  )
}
