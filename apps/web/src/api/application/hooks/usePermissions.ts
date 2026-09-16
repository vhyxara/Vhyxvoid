import { RoleLevel } from '@/api/domain/identity/enums/role.enum'
import type { Member } from '@/api/domain/identity/types/member.types'

import { useOrgDetail } from './useOrg'

// export type Permissions = {
//   myLevel: RoleLevel | 0
//   isOwner: boolean
//   isAdmin: boolean
//   isMember: boolean
//   canManage: (targetLevel: RoleLevel) => boolean
//   canPromoteTo: (targetLevel: RoleLevel) => boolean
//   isLoading: boolean
// }

// export function usePermissions(accountId: string): Permissions {
//   const { user } = useAuthStore()
//   const { data: members, isLoading } = useMembersList(accountId)

//   const myMembership = members?.find(m => m.userId === user?.id)
//   const myLevel = (myMembership?.role.level ?? 0) as RoleLevel | 0

//   return {
//     myLevel,
//     isOwner: myLevel === RoleLevel.OWNER,
//     isAdmin: myLevel >= RoleLevel.ADMIN,
//     isMember: myLevel >= RoleLevel.MEMBER,
//     canManage: target => myLevel > target,
//     canPromoteTo: target => myLevel > target,
//     isLoading
//   }
// }

export type Permissions = {
  myLevel: RoleLevel | 0
  isOwner: boolean
  isAdmin: boolean
  isMember: boolean

  /** Returns true if the current user outranks the target — allows managing them */
  // canManage: (targetLevel: RoleLevel) => boolean

  /** Returns true if the current user can assign the target level to someone */
  // canPromoteTo: (targetLevel: RoleLevel) => boolean

  // Backend-computed canManage per member row
  canManageRow: (member: Pick<Member, 'canManage'>) => boolean

  // Local computation for promote checks
  canPromoteTo: (targetLevel: RoleLevel) => boolean

  isLoading: boolean
}

// const members = {
//   id: 'ae695823-2e2e-4f2f-b27e-b9a18d456b5c',
//   email: 'test4@example.com',
//   firstName: 'Test',
//   lastName: 'Smith',
//   fullName: 'Test Smith',
//   isEmailVerified: false,
//   accounts: [
//     {
//       accountId: 'ccf67b43-6b18-4ac6-994f-d06151bb2983',
//       accountName: "Test's Workspace",
//       accountType: 'PERSONAL',
//       accountStatus: 'ACTIVE',
//       roleLevel: 100,
//       roleName: 'OWNER',
//       joinedAt: '2026-04-19T07:37:10.633Z'
//     },
//     {
//       accountId: '04c0136e-0419-4bc6-b081-52ed98c812f5',
//       accountName: 'test',
//       accountType: 'ORGANIZATION',
//       accountStatus: 'ACTIVE',
//       roleLevel: 100,
//       roleName: 'OWNER',
//       joinedAt: '2026-04-21T13:51:26.185Z'
//     },
//     {
//       accountId: 'b628addd-45a4-4168-b58b-fc30bb1edadc',
//       accountName: 'Acme',
//       accountType: 'ORGANIZATION',
//       accountStatus: 'ACTIVE',
//       roleLevel: 100,
//       roleName: 'OWNER',
//       joinedAt: '2026-04-22T12:38:35.278Z'
//     }
//   ]
// }

// const userId = useAuthStore(s => {

//   console.log('usePermissions', s)

//   return s.user?.id
// })

// const { data: members, isLoading } = useMembersList(accountId)
// const { data: members, isLoading } = useMembersData(accountId)
// const members = {
//   success: true,
//   message: 'Members fetched',
//   items: [
//     {
//       userId: 'ae695823-2e2e-4f2f-b27e-b9a18d456b5c',
//       email: 'test4@example.com',
//       firstName: 'Test',
//       lastName: 'Smith',
//       fullName: 'Test Smith',
//       isEmailVerified: false,
//       role: {
//         id: '0841ca44-180c-4e58-8f08-2eff6bc3b0c0',
//         name: 'Owner',
//         level: 100,
//         levelName: 'OWNER',
//         description: 'Full control. Cannot be removed or demoted without transfer.'
//       },
//       joinedAt: '2026-04-21T13:51:26.185Z',
//       isYou: true,
//       canManage: false,
//       user: {
//         email: 'test4@example.com',
//         firstName: 'Test',
//         lastName: 'Smith',
//         fullName: 'Test Smith',
//         isEmailVerified: false
//       }
//     }
//   ],
//   meta: {
//     page: 1,
//     limit: 20,
//     total: 1,
//     totalPages: 1
//   },
//   extra: {
//     accountId: '04c0136e-0419-4bc6-b081-52ed98c812f5'
//   }
// }
// const { data: members, isLoading } = useMembersData(accountId)

// console.log('members', members)
// const myMembership = members?.find(m => m.userId === userId)

// console.log('myMembership', myMembership)
// const myLevel = (myMembership?.role.level ?? 0) as RoleLevel | 0

// Use viewer context from backend — authoritative

// return {
//   myLevel,
//   isOwner: myLevel === RoleLevel.OWNER,
//   isAdmin: myLevel >= RoleLevel.ADMIN,
//   isMember: myLevel >= RoleLevel.MEMBER,
//   canManage: (target: RoleLevel) => myLevel > target,
//   canPromoteTo: (target: RoleLevel) => myLevel > target,
//   isLoading
// }
export function usePermissions(accountId: string): Permissions {
  const { data: members, isLoading } = useOrgDetail(accountId)

  const viewer = members?.viewer
  const myLevel = (viewer?.roleLevel ?? 0) as RoleLevel | 0

  return {
    myLevel,
    isOwner: viewer?.isOwner ?? false,
    isAdmin: viewer?.isAdmin ?? false,
    isMember: myLevel >= RoleLevel.MEMBER,

    // Backend already computed canManage per row — trust it
    canManageRow: member => member.canManage,
    canPromoteTo: target => myLevel > target,

    // isLoading
    isLoading: false
  }
}
