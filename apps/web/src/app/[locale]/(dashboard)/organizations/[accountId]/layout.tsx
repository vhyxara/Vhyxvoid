import { use, type ReactNode } from 'react'

import { AccountGuard } from '@/api/domain/identity/guard/AccountGuard'

// import { AuthGuard } from '@/domain/identity/guard/AuthGuard'

// app/(dashboard)/organizations/[accountId]/layout.tsx
// app/[locale]/(dashboard)/organizations/[accountId]/layout.tsx

type Props = {
  children: ReactNode
  params: Promise<{ accountId: string }> // Next.js 15 — params is a Promise
}

export default function OrgLayout({ children, params }: Props) {
  const { accountId } = use(params) // unwrap synchronously with React.use()

  // <AccountGuard accountId={accountId}>
  // </AccountGuard>
  return <AccountGuard accountId={accountId}>{children}</AccountGuard>
}

// <AuthGuard>
// </AuthGuard>
