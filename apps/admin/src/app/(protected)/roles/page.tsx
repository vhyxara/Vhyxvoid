'use client'

import { Card } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'

// Stub — real screen deferred to a later session, per
// internal-tools/admin-frontend/context.md's Part 3.5 screen list.
// GET/POST /admin/identity/roles, PUT/:id, plus role-ability assignment sub-view — client-side paginated, isActive:true hardcoded server-side.
export default function RolesPage() {
  return (
    <div className='flex flex-col gap-4'>
      <Typography variant='h4'>Roles</Typography>
      <Card className='p-6'>
        <Typography variant='body1'>Not built yet — coming in a later session.</Typography>
      </Card>
    </div>
  )
}
