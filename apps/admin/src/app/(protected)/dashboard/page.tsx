'use client'

import { useQuery } from '@tanstack/react-query'

import { Alert, Card, Spinner } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { adminAuthService } from '@/api/infrastructure/auth.service'

// Screen 2 (dashboard shell), doubling as this session's end-to-end auth
// proof: fetches GET /admin/identity/me with the real, wired-up
// httpClient (Authorization header from the auth store, refresh-on-401
// via wrapper/http.ts) rather than just trusting the login response's own
// payload. If this renders real data, the whole chain — login, token
// storage, Bearer-header attachment, and the backend's adminAuthGuard —
// is proven working, not just the login call in isolation.
export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: () => adminAuthService.me()
  })

  return (
    <div className='flex flex-col gap-4'>
      <Typography variant='h4'>Dashboard</Typography>

      <Card className='p-6'>
        {isLoading && <Spinner />}
        {error && <Alert variant='danger'>{(error as Error).message}</Alert>}
        {data && (
          <div className='flex flex-col gap-2'>
            <Typography variant='body1'>Signed in as {data.email}</Typography>
            <Typography variant='body2'>
              {data.isSuperAdmin ? 'Super admin — bypasses all ability checks.' : 'Regular admin.'}
            </Typography>
          </div>
        )}
      </Card>
    </div>
  )
}
