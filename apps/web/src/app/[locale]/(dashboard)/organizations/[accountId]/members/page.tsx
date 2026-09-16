// app/(dashboard)/organizations/[accountId]/members/page.tsx
// export default function MembersPage({ params }: { params: { accountId: string } }) {
//   return (
//     <MembersTable
//       accountId={params.accountId}
//       toolbar={
//         <RequireRole accountId={params.accountId} minLevel={RoleLevel.ADMIN}>
//           <InviteMemberButton accountId={params.accountId} />
//         </RequireRole>
//       }
//     />
//   )
// }

// import { AccountGuard } from '@/domain/identity/guard/AccountGuard'
// import { AuthGuard } from '@/domain/identity/guard/AuthGuard'
import { use } from 'react'

import { MembersTable } from '@/views/members/MembersTable'

// app/[locale]/(dashboard)/organizations/[accountId]/members/page.tsx

type Props = {
  params: Promise<{ accountId: string }>
}

export default function MembersPage({ params }: Props) {
  const { accountId } = use(params)

  return <MembersTable accountId={accountId} />
}

// <AuthGuard>
//   <AccountGuard accountId={params.accountId}>
//   </AccountGuard>
// </AuthGuard>
