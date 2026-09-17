'use client'

import { Card } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'

// Stub — real screen deferred to a later session, per
// internal-tools/admin-frontend/context.md's Part 3.5 screen list.
// GET/POST /admin/identity/users, PUT/:id, POST /:id/disable|enable — client-side paginated, no server page/limit/sort support.
export default function AdminUsersPage() {
  return (
    <div className='flex flex-col gap-4'>
      <Typography variant='h4'>Admin Users</Typography>
      <Card className='p-6'>
        <Typography variant='body1'>Not built yet — coming in a later session.</Typography>
      </Card>
    </div>
  )
}
