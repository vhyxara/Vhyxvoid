'use client'

import { useQuery } from '@tanstack/react-query'

import { Alert, Badge, Table, Tabs, Text } from '@vhyxui/react'

import { platformKeys } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import { formatLimit } from '@/components/ui/format'
import { LimitOverridesEditor } from '@/views/accounts/LimitOverridesEditor'

/** Edits the `plans.overrides` setting: per-plan changes to the built-in limits. */
export function PlanOverrides({ value, onSave }: { value: Record<string, any>; onSave: (v: Record<string, any> | null) => Promise<unknown> }) {
  const limits = useQuery({ queryKey: platformKeys.area('plan-limits'), queryFn: platformService.planLimits })
  const plans = ['FREE', 'PRO', 'ENTERPRISE']
  const builtIn = limits.data?.builtIn ?? {}
  const rows = Object.keys(builtIn.FREE ?? {}).map(k => ({ id: k, k, FREE: builtIn.FREE?.[k], PRO: builtIn.PRO?.[k], ENTERPRISE: builtIn.ENTERPRISE?.[k], how: limits.data?.enforcement?.[k] ?? '' }))

  return (
    <div className='flex flex-col gap-4'>
      <Alert variant='info'>
        Overrides change what every account on a plan gets, within a minute, without a deploy. Prices are set in Stripe and on the pricing page
        (Website content). Per-account exceptions are on each account&apos;s page.
      </Alert>
      <Tabs defaultValue='FREE' variant='pills'>
        <Tabs.List>
          {plans.map(p => (
            <Tabs.Trigger key={p} value={p}>
              {p} {value?.[p] && Object.keys(value[p]).length ? <Badge size='sm' variant='info'>overridden</Badge> : null}
            </Tabs.Trigger>
          ))}
          <Tabs.Trigger value='reference'>Built-in limits</Tabs.Trigger>
        </Tabs.List>
        {plans.map(p => (
          <Tabs.Content key={p} value={p}>
            <LimitOverridesEditor
              value={value?.[p] ?? null}
              onSave={next => {
                const all = { ...(value ?? {}) }

                if (next) all[p] = next
                else delete all[p]

                return onSave(Object.keys(all).length ? all : null)
              }}
            />
          </Tabs.Content>
        ))}
        <Tabs.Content value='reference'>
          <div style={{ overflowX: 'auto' }}>
            <Table
              density='compact'
              data={rows as any}
              columns={[
                { key: 'k', header: 'Limit', cell: (r: any) => <code>{r.k}</code> },
                ...plans.map(p => ({ key: p, header: p, cell: (r: any) => formatLimit(r[p]) })),
                { key: 'how', header: 'Enforced', cell: (r: any) => <Text size='xs'>{r.how}</Text> }
              ]}
            />
          </div>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
