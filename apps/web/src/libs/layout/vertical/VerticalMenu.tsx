// MUI Imports
import { useTheme } from '@mui/material/styles'

// Third-party Imports
import PerfectScrollbar from 'react-perfect-scrollbar'

// Type Imports
import { Chip, Box, Skeleton } from '@mui/material'

import type { VerticalMenuContextProps } from '@menu/components/vertical-menu/Menu'

// Component Imports
import { Menu, MenuItem, MenuSection, SubMenu } from '@menu/vertical-menu'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'

// Styled Component Imports
import StyledVerticalNavExpandIcon from '@menu/styles/vertical/StyledVerticalNavExpandIcon'

// Style Imports
import menuItemStyles from '@core/styles/vertical/menuItemStyles'
import menuSectionStyles from '@core/styles/vertical/menuSectionStyles'
import { RoleLevel } from '@/api/domain/identity/enums/role.enum'
import type { MyAccount } from '@/api/domain/identity/types/org.types'
import { useMyAccounts } from '@/api/application/hooks/useMe'

type RenderExpandIconProps = {
  open?: boolean
  transitionDuration?: VerticalMenuContextProps['transitionDuration']
}

type Props = {
  scrollMenu: (container: any, isPerfectScrollbar: boolean) => void
}

const RenderExpandIcon = ({ open, transitionDuration }: RenderExpandIconProps) => (
  <StyledVerticalNavExpandIcon open={open} transitionDuration={transitionDuration}>
    <i className='tabler-chevron-right' />
  </StyledVerticalNavExpandIcon>
)

// ── Org role badge ────────────────────────────────────────────────────────
// Shows a tiny role chip next to org name — owner/admin distinction matters

function RoleBadge({ roleLevel }: { roleLevel: RoleLevel }) {
  if (roleLevel === RoleLevel.OWNER) {
    return (
      <Chip label='Owner' size='small' color='error' variant='tonal' sx={{ height: 18, fontSize: 10, ml: 'auto' }} />
    )
  }

  if (roleLevel === RoleLevel.ADMIN) {
    return (
      <Chip label='Admin' size='small' color='warning' variant='tonal' sx={{ height: 18, fontSize: 10, ml: 'auto' }} />
    )
  }

  return null
}

// ── Single org submenu ────────────────────────────────────────────────────

// function OrgSubMenu({ account }: { account: MyAccount }) {
//   const isAdmin = account.roleLevel >= RoleLevel.ADMIN
//   const orgName = account.accountName ?? 'Unnamed organization'

//   return (
//     <SubMenu
//       label={
//         <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
//           <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orgName}</span>
//           <RoleBadge roleLevel={account.roleLevel} />
//         </Box>
//       }
//       icon={<i className='tabler-building' />}
//     >
//       <MenuItem href={`/organizations/${account.accountId}/members`} icon={<i className='tabler-users' />}>
//         Members
//       </MenuItem>

//       {/* Settings only visible to ADMIN+ */}
//       {isAdmin && (
//         <MenuItem href={`/organizations/${account.accountId}/settings`} icon={<i className='tabler-settings' />}>
//           Settings
//         </MenuItem>
//       )}
//     </SubMenu>
//   )
// }

function OrgSubMenu({ account }: { account: MyAccount }) {
  const isAdmin = account.roleLevel >= RoleLevel.ADMIN
  const isOwner = account.roleLevel === RoleLevel.OWNER
  const orgName = account.accountName ?? 'Unnamed organization'
  const id = account.accountId

  return (
    <SubMenu
      label={
        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orgName}</span>
          <RoleBadge roleLevel={account.roleLevel} />
        </Box>
      }
      icon={<i className='tabler-building' />}
    >
      <MenuItem href={`/organizations/${id}/members`} icon={<i className='tabler-users' />}>
        Members
      </MenuItem>
      <MenuItem href={`/organizations/${id}/api-keys`} icon={<i className='tabler-key' />}>
        API Keys
      </MenuItem>
      <MenuItem href={`/organizations/${id}/tunnels`} icon={<i className='tabler-plug' />}>
        Tunnels
      </MenuItem>
      {isOwner && (
        <MenuItem href={`/organizations/${id}/billing`} icon={<i className='tabler-credit-card' />}>
          Billing
        </MenuItem>
      )}
      {isAdmin && (
        <MenuItem href={`/organizations/${id}/settings`} icon={<i className='tabler-settings' />}>
          Settings
        </MenuItem>
      )}
    </SubMenu>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────

function NavSkeleton() {
  return (
    <Box sx={{ px: 3, py: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {[1, 2, 3].map(i => (
        <Skeleton key={i} variant='rounded' height={36} sx={{ borderRadius: 2 }} />
      ))}
    </Box>
  )
}

const VerticalMenu = ({ scrollMenu }: Props) => {
  // Hooks
  const theme = useTheme()
  const verticalNavOptions = useVerticalNav()

  // Vars
  const { isBreakpointReached, transitionDuration } = verticalNavOptions

  // Reads from meKeys.detail() cache — populated by useMe in dashboard layout.
  // Zero extra fetches — same cache entry, selector only.
  const { data: accounts, isLoading } = useMyAccounts()

  const ScrollWrapper = isBreakpointReached ? 'div' : PerfectScrollbar

  // Separate personal account from org accounts
  // const personalAccount = accounts?.find(a => a.accountType === 'PERSONAL')
  const orgAccounts = accounts?.filter(a => a.accountType === 'ORGANIZATION') ?? []

  return (
    // eslint-disable-next-line lines-around-comment
    /* Custom scrollbar instead of browser scroll, remove if you want browser scroll only */
    <ScrollWrapper
      {...(isBreakpointReached
        ? {
            className: 'bs-full overflow-y-auto overflow-x-hidden',
            onScroll: container => scrollMenu(container, false)
          }
        : {
            options: { wheelPropagation: false, suppressScrollX: true },
            onScrollY: container => scrollMenu(container, true)
          })}
    >
      {/* Incase you also want to scroll NavHeader to scroll with Vertical Menu, remove NavHeader from above and paste it below this comment */}
      {/* Vertical Menu */}
      <Menu
        popoutMenuOffset={{ mainAxis: 23 }}
        menuItemStyles={menuItemStyles(verticalNavOptions, theme)}
        renderExpandIcon={({ open }) => <RenderExpandIcon open={open} transitionDuration={transitionDuration} />}
        renderExpandedMenuItemIcon={{ icon: <i className='tabler-circle text-xs' /> }}
        menuSectionStyles={menuSectionStyles(verticalNavOptions, theme)}
      >
        {/* ── Home ── */}
        <MenuItem href='/dashboard' icon={<i className='tabler-smart-home' />}>
          Dashboard
        </MenuItem>

        {/* ── Organizations section ── */}
        <MenuSection label='Organizations' icon={<i className='tabler-building' />}>
          {isLoading ? (
            <NavSkeleton />
          ) : orgAccounts.length === 0 ? (
            <MenuItem href='/dashboard' icon={<i className='tabler-plus' />}>
              Create organization
            </MenuItem>
          ) : (
            orgAccounts.map(account => <OrgSubMenu key={account.accountId} account={account} />)
          )}
        </MenuSection>

        {/* ── Quick links ── */}
        <MenuSection label='Account' icon={<i className='tabler-settings' />}>
          <MenuItem href='/profile' icon={<i className='tabler-user' />}>
            My profile
          </MenuItem>
        </MenuSection>
      </Menu>

      {/* <Menu
        popoutMenuOffset={{ mainAxis: 23 }}
        menuItemStyles={menuItemStyles(verticalNavOptions, theme)}
        renderExpandIcon={({ open }) => <RenderExpandIcon open={open} transitionDuration={transitionDuration} />}
        renderExpandedMenuItemIcon={{ icon: <i className='tabler-circle text-xs' /> }}
        menuSectionStyles={menuSectionStyles(verticalNavOptions, theme)}
      >
        <GenerateVerticalMenu menuData={menuData(dictionary)} />
      </Menu> */}
    </ScrollWrapper>
  )
}

export default VerticalMenu
