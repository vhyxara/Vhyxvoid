'use client'

// VhyxUI components aren't RSC-safe (confirmed in Step 0's link smoke test —
// see decision.md) — any page rendering one needs this boundary.

import Link from 'next/link'

import { Button } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'

export default function LandingPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
        padding: '32px',
        textAlign: 'center'
      }}
    >
      <Typography variant='h1'>VhyxVoid</Typography>
      <Typography variant='body1' style={{ maxWidth: 480, color: 'var(--vhyx-color-text-subtle)' }}>
        Secure localhost tunnels for developers. Expose your local services to the internet in seconds.
      </Typography>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Button asChild variant='primary'>
          <Link href='/dashboard'>Go to dashboard</Link>
        </Button>
        <Button asChild variant='outline'>
          <Link href='/login'>Sign in</Link>
        </Button>
      </div>
    </main>
  )
}
