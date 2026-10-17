'use client'

// When a page fails to render: the void's look instead of Next's plain error
// screen, with "Try again" (re-renders the page) and the ways back. The error
// itself goes to the console for whoever is debugging; visitors see the
// reference only.
import { useEffect } from 'react'

import { VoidNotFound } from '@/views/marketing/void/VoidNotFound'
import voidStyles from '@/views/marketing/void/void.module.css'

export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error])

  return (
    <div data-theme='dark' data-brand='vhyxvoid' className={voidStyles.void}>
      <VoidNotFound
        code='500'
        title='Signal lost'
        message={
          <>
            Something went wrong while loading this page. Try again in a moment.
            {error.digest && (
              <>
                {' '}
                Reference: <code>{error.digest}</code>
              </>
            )}
          </>
        }
        onRetry={reset}
        links={[{ label: 'Support', href: '/support' }]}
      />
    </div>
  )
}
