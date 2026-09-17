import { redirect } from 'next/navigation'

export default function RootPage() {
  // Server Component -- can't read the (client-only, sessionStorage-backed)
  // auth store here. Always send to /login; AdminAuthGuard on the protected
  // routes handles "already logged in" by simply not redirecting away.
  redirect('/login')
}
