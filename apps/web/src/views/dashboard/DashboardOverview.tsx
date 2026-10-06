'use client'

import Link from 'next/link'

import { Alert, Button, Card, Grid } from '@vhyxui/react'
import { PageHeader, StatCard } from '@vhyxui/blocks'

import { Typography } from '@/components/vhyxui-shims'
import { useMe } from '@/api/application/hooks/useMe'
import { useUsageSummary } from '@/api/application/hooks/useTunnels'
import { setting, usePublicBootstrap } from '@/api/application/hooks/usePublicSite'
import type { MyAccount } from '@/api/domain/identity/types/org.types'
import { TrafficCard } from '@/views/org/tunnels/TrafficCard'

const formatNumber = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString())

// The workspace the overview summarises: the personal one if the user has
// it, otherwise the first they belong to.
export function pickPrimaryAccount(accounts: MyAccount[] | undefined): MyAccount | undefined {
  if (!accounts?.length) return undefined

  return accounts.find(a => a.accountType === 'PERSONAL') ?? accounts[0]
}

type Step = { done: boolean; title: string; body: string; href?: string; cta?: string; code?: string }

export function buildChecklist(input: {
  emailVerified: boolean
  activeApiKeys: number
  activeTunnels: number
  totalRequests: number
  apiKeysHref?: string
}): Step[] {
  return [
    {
      done: input.emailVerified,
      title: 'Verify your email',
      body: 'Confirms the address we send security and billing notices to.'
    },
    {
      done: input.activeApiKeys > 0,
      title: 'Create an API key',
      body: 'Give it the tunnel:connect scope. The agent uses it to sign in.',
      href: input.apiKeysHref,
      cta: 'Open API keys'
    },
    {
      done: input.activeTunnels > 0 || input.totalRequests > 0,
      title: 'Start your first tunnel',
      body: 'Run the agent next to your local server and follow the prompts.',
      code: 'npx @vhyxvoid/agent init'
    }
  ]
}

export function DashboardOverview() {
  const me = useMe()
  const primary = pickPrimaryAccount(me.data?.accounts)
  const summary = useUsageSummary(primary?.accountId ?? '')
  const { data: site } = usePublicBootstrap()
  const docs = setting<string>(site, 'support.docsUrl', '') || '/docs'

  const stats = summary.data?.stats
  const loading = me.isLoading || (!!primary && summary.isLoading)
  const base = primary ? `/organizations/${primary.accountId}` : undefined

  const steps = buildChecklist({
    emailVerified: !!me.data?.isEmailVerified,
    activeApiKeys: stats?.activeApiKeys ?? 0,
    activeTunnels: stats?.activeTunnels ?? 0,
    totalRequests: stats?.totalRequests ?? 0,
    apiKeysHref: base ? `${base}/api-keys` : undefined
  })

  const remaining = steps.filter(s => !s.done).length
  const name = me.data?.firstName || me.data?.fullName?.split(' ')[0]

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title={name ? `Welcome back, ${name}` : 'Overview'}
        description={
          primary
            ? `Activity for ${primary.accountName ?? 'your personal workspace'}${summary.data ? ` · ${summary.data.period.label}` : ''}`
            : 'Your workspaces, tunnels and keys at a glance.'
        }
        actions={[
          <Button key='docs' variant='outline' asChild>
            <a href={docs}>Read the docs</a>
          </Button>,
          ...(base
            ? [
                <Button key='tunnels' asChild>
                  <Link href={`${base}/tunnels`}>View tunnels</Link>
                </Button>
              ]
            : [])
        ]}
      />

      {summary.error ? <Alert variant='warning'>Usage figures are unavailable right now.</Alert> : null}

      <Grid minChildWidth='12rem' gap={4}>
        <StatCard label='Live tunnels' value={formatNumber(stats?.activeTunnels)} loading={loading} />
        <StatCard
          label='Requests'
          value={formatNumber(stats?.totalRequests)}
          hint={summary.data?.period.label}
          loading={loading}
        />
        <StatCard label='Active API keys' value={formatNumber(stats?.activeApiKeys)} loading={loading} />
        <StatCard label='Workspaces' value={formatNumber(me.data?.accounts.length)} loading={me.isLoading} />
      </Grid>

      {primary && remaining === 0 && <TrafficCard accountId={primary.accountId} compact title='Traffic' />}

      {!me.isLoading && remaining > 0 && (
        <Card className='p-6'>
          <div className='flex flex-col gap-1 mbe-4'>
            <Typography variant='h6'>Get started</Typography>
            <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-muted)' }}>
              {steps.length - remaining} of {steps.length} done. A public HTTPS URL is a few minutes away.
            </Typography>
          </div>
          <ol className='flex flex-col gap-4' style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {steps.map((step, i) => (
              <li key={step.title} className='flex gap-3 items-start'>
                <span
                  aria-hidden
                  style={{
                    inlineSize: 28,
                    blockSize: 28,
                    flex: '0 0 28px',
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 13,
                    fontWeight: 600,
                    background: step.done ? 'var(--vhyx-color-success)' : 'var(--vhyx-color-bg-muted)',
                    color: step.done ? 'var(--vhyx-color-text-on-accent)' : 'var(--vhyx-color-text)'
                  }}
                >
                  {step.done ? '✓' : i + 1}
                </span>
                <div className='flex flex-col gap-1' style={{ minInlineSize: 0, flex: 1 }}>
                  <Typography
                    variant='body1'
                    style={{ fontWeight: 600, textDecoration: step.done ? 'line-through' : undefined }}
                  >
                    {step.title}
                    <span className='sr-only'>{step.done ? ' (done)' : ''}</span>
                  </Typography>
                  <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-muted)' }}>
                    {step.body}
                  </Typography>
                  {!step.done && step.code && (
                    <code
                      style={{
                        alignSelf: 'flex-start',
                        maxInlineSize: '100%',
                        overflowX: 'auto',
                        padding: '4px 8px',
                        borderRadius: 6,
                        background: 'var(--vhyx-color-bg-muted)',
                        fontSize: 13
                      }}
                    >
                      {step.code}
                    </code>
                  )}
                  {!step.done && step.href && step.cta && (
                    <Link href={step.href} style={{ color: 'var(--vhyx-color-accent)', fontSize: 14 }}>
                      {step.cta} →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}
