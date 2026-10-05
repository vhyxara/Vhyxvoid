import type { ReactNode } from 'react'

import { Text } from '@vhyxui/react'

/** Label/value pairs for detail pages. */
export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className='grid gap-x-6 gap-y-3' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))' }}>
      {items.map(([label, value]) => (
        <div key={label} className='flex flex-col gap-0.5 min-is-0'>
          <dt>
            <Text size='xs' tone='muted'>
              {label}
            </Text>
          </dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
