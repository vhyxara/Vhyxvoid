'use client'

import { Button, Popover, Separator } from '@vhyxui/react'

import { Avatar, Typography } from '@/components/vhyxui-shims'
import { useLogout } from '@/api/application/hooks/useLogout'
import { useAuthStore } from '@/api/domain/identity/store/auth.store'
import { getInitials } from '@/utils/getInitials'
import { getDisplayName } from '@/utils/utility'
import { useMyProfile } from '@/api/application/hooks/useMe'

import styles from './UserDropdown.module.css'

// Ported 1:1 from libs/layout/shared/UserDropdown.tsx. Confirmed by
// investigation: 4 of 5 menu items (My Profile/Settings/Pricing/FAQ) are
// pre-existing non-functional placeholders (only close the menu, no `url`
// passed to the original's handleDropdownClose) — reproduced faithfully as
// the same non-functional placeholders here, not fixed or removed, since
// that's a pre-existing product gap outside this migration's scope. Only
// Logout is real.
export function UserDropdown() {
  const { data: profile } = useMyProfile()
  const user = useAuthStore(s => s.user)
  const { mutate: logout, isPending } = useLogout()

  const displayName = getDisplayName(
    profile?.firstName ?? user?.firstName,
    profile?.lastName ?? user?.lastName,
    profile?.email ?? user?.email
  )
  const initials = getInitials(displayName)

  return (
    <Popover>
      <Popover.Trigger className={styles.trigger} aria-label='Account menu'>
        <Avatar size='md' alt={displayName}>
          {initials}
        </Avatar>
        <span className={styles.onlineDot} aria-hidden='true' />
      </Popover.Trigger>

      <Popover.Content side='bottom' align='end' className={styles.menu}>
        <div className={styles.userInfo}>
          <Avatar size='md' alt={displayName}>
            {initials}
          </Avatar>
          <div className={styles.userText}>
            <span className={styles.userName}>{displayName}</span>
            <span className={styles.userEmail}>{user?.email ?? ''}</span>
          </div>
        </div>

        <Separator style={{ margin: '4px 0' }} />

        <Popover.Close className={styles.item}>
          <i className='tabler-user' />
          <Typography variant='body1'>My Profile</Typography>
        </Popover.Close>
        <Popover.Close className={styles.item}>
          <i className='tabler-settings' />
          <Typography variant='body1'>Settings</Typography>
        </Popover.Close>
        <Popover.Close className={styles.item}>
          <i className='tabler-currency-dollar' />
          <Typography variant='body1'>Pricing</Typography>
        </Popover.Close>
        <Popover.Close className={styles.item}>
          <i className='tabler-help-circle' />
          <Typography variant='body1'>FAQ</Typography>
        </Popover.Close>

        <div className={styles.logoutRow}>
          <Button
            variant='destructive'
            size='sm'
            disabled={isPending}
            icon={<i className='tabler-logout' />}
            iconPosition='right'
            onClick={() => logout()}
            style={{ width: '100%' }}
          >
            {isPending ? 'Logging out...' : 'Logout'}
          </Button>
        </div>
      </Popover.Content>
    </Popover>
  )
}
