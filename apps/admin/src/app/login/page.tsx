import { Suspense } from 'react'

import AdminLogin from '@/views/auth/AdminLogin'

// useSearchParams (the `next` redirect) needs a Suspense boundary.
export default function LoginPage() {
  return (
    <Suspense>
      <AdminLogin />
    </Suspense>
  )
}
