import type { ReactNode } from 'react'

import { Card, Heading, Text } from '@vhyxui/react'

/** A titled card section. */
export function Section({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card variant='outline' padding='md'>
      <div className='flex flex-wrap items-start justify-between gap-2 mbe-4'>
        <div>
          <Heading level={3} size='sm'>
            {title}
          </Heading>
          {description && (
            <Text size='sm' tone='muted'>
              {description}
            </Text>
          )}
        </div>
        {actions && <div className='flex flex-wrap gap-2'>{actions}</div>}
      </div>
      {children}
    </Card>
  )
}
