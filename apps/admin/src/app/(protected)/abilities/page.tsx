'use client'

import { Card } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'

// Stub — real screen deferred to a later session, per
// internal-tools/admin-frontend/context.md's Part 3.5 screen list.
// GET/POST/DELETE /admin/identity/abilities — no PUT/edit endpoint exists (confirmed by reading admin.routes.ts).
export default function AbilitiesPage() {
  return (
    <div className='flex flex-col gap-4'>
      <Typography variant='h4'>Abilities</Typography>
      <Card className='p-6'>
        <Typography variant='body1'>Not built yet — coming in a later session.</Typography>
      </Card>
    </div>
  )
}
