'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { PageHeader, SettingsSection } from '@vhyxui/blocks'
import { Alert, Badge, Button, Card, Input, SelectField, Skeleton, Switch, Text, toast } from '@vhyxui/react'

import { platformKeys, useSettings } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { StripePriceLookup } from '@/api/platform/types'
import { formatMoney } from '@/components/ui/format'
import { PlanOverrides } from './PlanOverrides'

const PLANS = ['FREE', 'PRO', 'ENTERPRISE'] as const

function ModeTile({ active, title, body, onClick }: { active: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-pressed={active}
      style={{
        textAlign: 'start',
        padding: 16,
        borderRadius: 12,
        cursor: 'pointer',
        background: active ? 'var(--vhyx-color-accent-subtle, transparent)' : 'transparent',
        border: `2px solid ${active ? 'var(--vhyx-color-accent)' : 'var(--vhyx-color-border)'}`,
        color: 'inherit',
        font: 'inherit'
      }}
    >
      <div className='flex items-center gap-2 mbe-1'>
        <Text weight='semibold'>{title}</Text>
        {active && (
          <Badge size='sm' variant='success'>
            current
          </Badge>
        )}
      </div>
      <Text size='sm' tone='muted'>
        {body}
      </Text>
    </button>
  )
}

function PriceStatus({ l }: { l: StripePriceLookup }) {
  if (!l.id) return <Text size='sm' tone='muted'>Not set: this plan cannot be bought.</Text>
  if (l.error) return <Text size='sm' tone='danger'>{l.error}</Text>
  if (!l.price) return null

  const p = l.price

  return (
    <Text size='sm'>
      {p.productName ? <strong>{p.productName}</strong> : null} {formatMoney(p.unitAmount, p.currency)}
      {p.interval ? ` / ${p.interval}` : ' one-time'}{' '}
      {p.active ? <Badge size='sm' variant='success'>active</Badge> : <Badge size='sm' variant='danger'>archived</Badge>}
      {l.source === 'environment' ? <Text as='span' size='xs' tone='muted'> (from environment)</Text> : null}
    </Text>
  )
}

export function PlansPricingView() {
  const qc = useQueryClient()
  const settings = useSettings()
  const setup = useQuery({ queryKey: platformKeys.area('billing-setup'), queryFn: platformService.billingSetup })

  const value = (key: string) => settings.data?.settings.find(s => s.key === key)?.value

  const [message, setMessage] = useState('')
  const [trialDays, setTrialDays] = useState<number | null>(14)
  const [prices, setPrices] = useState<{ PRO: string; ENTERPRISE: string }>({ PRO: '', ENTERPRISE: '' })
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!settings.data) return
    setMessage(String(value('billing.freeModeMessage') ?? ''))
    setTrialDays(Number(value('billing.trialDays') ?? 0))
    const stored = (value('billing.stripePrices') ?? {}) as Record<string, string>

    setPrices({ PRO: stored.PRO ?? '', ENTERPRISE: stored.ENTERPRISE ?? '' })
  }, [settings.data])

  const save = async (label: string, changes: Record<string, unknown>) => {
    setSaving(label)
    try {
      const fresh = await platformService.updateSettings(changes)

      qc.setQueryData(platformKeys.area('settings'), fresh)
      await Promise.all([
        qc.invalidateQueries({ queryKey: platformKeys.area('billing-setup') }),
        qc.invalidateQueries({ queryKey: platformKeys.area('plan-limits') })
      ])
      toast.success('Saved. Live within a minute.')
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(null)
    }
  }

  if (settings.error) return <Alert variant='danger'>{(settings.error as Error).message}</Alert>
  if (!settings.data) return <Skeleton height='24rem' />

  const mode = value('billing.mode') as 'free' | 'paid'
  const defaultPlan = String(value('billing.defaultPlan') ?? 'FREE')
  const checkoutEnabled = value('billing.checkoutEnabled') === true
  const s = setup.data

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Plans & pricing'
        description='Decide whether the product is free or paid, what each plan allows, and what it costs. Changes apply within a minute, no deploy.'
      />

      {s?.problems.length ? (
        <Alert variant='warning' title='Paid plans will not work yet'>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {s.problems.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <SettingsSection title='Billing mode' description='Start free, switch to paid when you are ready. Accounts that already pay keep their subscription in both modes.'>
        <div className='flex flex-col gap-4'>
          <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
            <ModeTile
              active={mode === 'free'}
              title='Free (launch / early access)'
              body='Nobody is asked to pay. Upgrade buttons and paid tiers are hidden; the pricing page shows your free message. Stripe is not needed.'
              onClick={() => mode !== 'free' && save('mode', { 'billing.mode': 'free' })}
            />
            <ModeTile
              active={mode === 'paid'}
              title='Paid'
              body='Pro and Enterprise can be bought through Stripe checkout. Needs Stripe keys and a price for each paid plan (below).'
              onClick={() => mode !== 'paid' && save('mode', { 'billing.mode': 'paid' })}
            />
          </div>

          <div className='grid gap-4' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
            <div className='flex flex-col gap-2'>
              <SelectField
                name='defaultPlan'
                label='Plan for accounts that do not pay'
                hint='During a launch you can give everyone Pro. Change each plan’s limits below.'
                value={defaultPlan}
                onValueChange={v => save('defaultPlan', { 'billing.defaultPlan': v })}
                options={PLANS.map(p => ({ value: p, label: p }))}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Text weight='medium'>Free mode message</Text>
              <Input aria-label='Free mode message' value={message} maxLength={160} onChange={e => setMessage(e.target.value)} />
              <div>
                <Button size='sm' variant='outline' loading={saving === 'message'} onClick={() => save('message', { 'billing.freeModeMessage': message })}>
                  Save message
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title='Plan limits' description='What each plan allows. Exceptions for one customer are on that account’s page.'>
        <PlanOverrides value={(value('plans.overrides') as Record<string, Record<string, unknown>>) ?? {}} onSave={v => save('limits', { 'plans.overrides': v })} />
      </SettingsSection>

      <SettingsSection
        title='Payments (Stripe)'
        description='Prices live in Stripe. Create a product with a monthly price for each paid plan in the Stripe dashboard, then paste the price IDs here.'
      >
        <div className='flex flex-col gap-4'>
          <div className='flex flex-wrap gap-2 items-center'>
            <Text weight='medium'>Stripe keys</Text>
            {setup.isLoading ? (
              <Skeleton height='1.25rem' width='6rem' />
            ) : s?.stripe.configured ? (
              <>
                <Badge variant='success'>connected</Badge>
                {s.stripe.testMode && <Badge variant='warning'>test mode</Badge>}
              </>
            ) : (
              <>
                <Badge variant='outline'>not set</Badge>
                <Text size='sm' tone='muted'>
                  Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET on the API server (secrets never go in the admin panel).
                </Text>
              </>
            )}
          </div>

          {(['PRO', 'ENTERPRISE'] as const).map(plan => {
            const lookup = s?.prices.find(p => p.plan === plan)

            return (
              <Card key={plan} className='p-4'>
                <div className='flex flex-col gap-2'>
                  <Text weight='semibold'>{plan} price</Text>
                  <div className='flex flex-wrap gap-2 items-center'>
                    <Input
                      aria-label={`${plan} Stripe price ID`}
                      placeholder={lookup?.source === 'environment' ? `${lookup.id} (environment)` : 'price_…'}
                      value={prices[plan]}
                      onChange={e => setPrices(p => ({ ...p, [plan]: e.target.value.trim() }))}
                      style={{ minInlineSize: 280 }}
                    />
                    <Button
                      size='sm'
                      loading={saving === plan}
                      onClick={() => save(plan, { 'billing.stripePrices': { ...((value('billing.stripePrices') as object) ?? {}), [plan]: prices[plan] } })}
                    >
                      Save and check
                    </Button>
                  </div>
                  {lookup ? <PriceStatus l={lookup} /> : null}
                </div>
              </Card>
            )
          })}

          <div className='flex flex-wrap gap-6 items-end'>
            <div className='flex items-center gap-2'>
              <Switch checked={checkoutEnabled} onCheckedChange={v => save('checkout', { 'billing.checkoutEnabled': v })} aria-label='Allow upgrades' />
              <Text>Allow upgrades</Text>
              <Text size='sm' tone='muted'>
                (pause checkout without leaving paid mode)
              </Text>
            </div>
            <div className='flex items-end gap-2'>
              <div>
                <Text size='sm' weight='medium'>
                  Trial days (first subscription)
                </Text>
                <Input
                  type='number'
                  aria-label='Trial days'
                  min={0}
                  max={90}
                  value={trialDays ?? ''}
                  onChange={e => setTrialDays(e.target.value === '' ? null : Number(e.target.value))}
                  style={{ maxInlineSize: 120 }}
                />
              </div>
              <Button size='sm' variant='outline' loading={saving === 'trial'} onClick={() => save('trial', { 'billing.trialDays': trialDays ?? 0 })}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title='Pricing page' description='What visitors read. Limits on the page come from the plan limits above automatically.'>
        <Text>
          Plan names, displayed prices and feature bullets are edited in <Link href='/content'>Website content → Pricing page</Link>. Keep the displayed
          price the same as the Stripe price.
        </Text>
      </SettingsSection>
    </div>
  )
}
