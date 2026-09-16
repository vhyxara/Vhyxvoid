'use client'

// React Imports
import { useRef, useState } from 'react'
import type { MouseEvent } from 'react'

// Next Imports
import { useRouter } from 'next/navigation'

// MUI Imports
import { styled } from '@mui/material/styles'
import Badge from '@mui/material/Badge'
import Avatar from '@mui/material/Avatar'
import Popper from '@mui/material/Popper'
import Fade from '@mui/material/Fade'
import Paper from '@mui/material/Paper'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import MenuList from '@mui/material/MenuList'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'
import { useLogout } from '@/api/application/hooks/useLogout'
import { useAuthStore } from '@/api/domain/identity/store/auth.store'
import { getInitials } from '@/utils/getInitials'
import { getDisplayName } from '@/utils/utility'
import { useMe, useMyProfile } from '@/api/application/hooks/useMe'

const BadgeContentSpan = styled('span')({
  width: 8,
  height: 8,
  borderRadius: '50%',
  cursor: 'pointer',
  backgroundColor: 'var(--mui-palette-success-main)',
  boxShadow: '0 0 0 2px var(--mui-palette-background-paper)'
})

// ── Component ─────────────────────────────────────────────────────────────

const UserDropdown = () => {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  const router = useRouter()
  const { settings } = useSettings()

  // Replace the user destructure in UserDropdown:
  const { data: profile } = useMyProfile()

  console.log('🚀 ~ file: UserDropdown.tsx:84 ~ profile:', profile)

  // const { data: me } = useMe()
  const user = useAuthStore(s => s.user)

  // Prefer enriched me data for display, fall back to store
  // const displayName = getDisplayName(
  //   me?.firstName ?? user?.firstName,
  //   me?.lastName ?? user?.lastName,
  //   me?.email ?? user?.email
  // )

  const displayName = getDisplayName(
    profile?.firstName ?? user?.firstName,
    profile?.lastName ?? user?.lastName,
    profile?.email ?? user?.email
  )

  const initials = getInitials(displayName)

  // Real user data from Zustand store — populated on login / bootstrap
  // const user = useAuthStore(s => s.user)

  console.log('🚀 ~ file: UserDropdown.tsx:88 ~ user:', user)

  // const displayName = getDisplayName(user?.firstName, user?.lastName, user?.email)

  console.log('🚀 ~ file: UserDropdown.tsx:90 ~ displayName:', displayName)

  // const initials = getInitials(displayName)

  const { mutate: logout, isPending } = useLogout()

  const handleDropdownOpen = () => setOpen(prev => !prev)

  const handleDropdownClose = (event?: MouseEvent<HTMLLIElement> | (MouseEvent | TouchEvent), url?: string) => {
    if (url) router.push(url)
    if (anchorRef.current && anchorRef.current.contains(event?.target as HTMLElement)) return
    setOpen(false)
  }

  return (
    <>
      <Badge
        ref={anchorRef}
        overlap='circular'
        badgeContent={<BadgeContentSpan onClick={handleDropdownOpen} />}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        className='mis-2'
      >
        <Avatar
          alt={displayName}
          onClick={handleDropdownOpen}
          className='cursor-pointer bs-[38px] is-[38px]'
          sx={{ bgcolor: 'primary.main', fontSize: 14, fontWeight: 500 }}
        >
          {initials}
        </Avatar>
      </Badge>

      <Popper
        open={open}
        transition
        disablePortal
        placement='bottom-end'
        anchorEl={anchorRef.current}
        className='min-is-60 mbs-3! z-1'
      >
        {({ TransitionProps, placement }) => (
          <Fade
            {...TransitionProps}
            style={{
              transformOrigin: placement === 'bottom-end' ? 'right top' : 'left top'
            }}
          >
            <Paper className={settings.skin === 'bordered' ? 'border shadow-none' : 'shadow-lg'}>
              <ClickAwayListener onClickAway={e => handleDropdownClose(e as MouseEvent | TouchEvent)}>
                <MenuList>
                  {/* ── User info ── */}
                  <div className='flex items-center plb-2 pli-6 gap-2' tabIndex={-1}>
                    <Avatar
                      alt={displayName}
                      sx={{
                        bgcolor: 'primary.main',
                        fontSize: 14,
                        fontWeight: 500
                      }}
                    >
                      {initials}
                    </Avatar>
                    <div className='flex items-start flex-col'>
                      <Typography className='font-medium' color='text.primary' noWrap sx={{ maxWidth: 140 }}>
                        {displayName}
                      </Typography>
                      <Typography variant='caption' color='text.secondary' noWrap sx={{ maxWidth: 140 }}>
                        {user?.email ?? ''}
                      </Typography>
                    </div>
                  </div>

                  <Divider className='mlb-1' />

                  <MenuItem className='mli-2 gap-3' onClick={e => handleDropdownClose(e)}>
                    <i className='tabler-user' />
                    <Typography color='text.primary'>My Profile</Typography>
                  </MenuItem>

                  <MenuItem className='mli-2 gap-3' onClick={e => handleDropdownClose(e)}>
                    <i className='tabler-settings' />
                    <Typography color='text.primary'>Settings</Typography>
                  </MenuItem>

                  <MenuItem className='mli-2 gap-3' onClick={e => handleDropdownClose(e)}>
                    <i className='tabler-currency-dollar' />
                    <Typography color='text.primary'>Pricing</Typography>
                  </MenuItem>

                  <MenuItem className='mli-2 gap-3' onClick={e => handleDropdownClose(e)}>
                    <i className='tabler-help-circle' />
                    <Typography color='text.primary'>FAQ</Typography>
                  </MenuItem>

                  <div className='flex items-center plb-2 pli-3'>
                    <Button
                      fullWidth
                      variant='contained'
                      color='error'
                      size='small'
                      disabled={isPending}
                      endIcon={<i className='tabler-logout' />}
                      onClick={() => logout()}
                      sx={{
                        '& .MuiButton-endIcon': { marginInlineStart: 1.5 }
                      }}
                    >
                      {isPending ? 'Logging out...' : 'Logout'}
                    </Button>
                  </div>
                </MenuList>
              </ClickAwayListener>
            </Paper>
          </Fade>
        )}
      </Popper>
    </>
  )
}

export default UserDropdown

// import { useLogout } from '@/api/hooks/auth'

// Styled component for badge content
// const BadgeContentSpan = styled('span')({
//   width: 8,
//   height: 8,
//   borderRadius: '50%',
//   cursor: 'pointer',
//   backgroundColor: 'var(--mui-palette-success-main)',
//   boxShadow: '0 0 0 2px var(--mui-palette-background-paper)'
// })

// const UserDropdown = () => {
//   // States
//   const [open, setOpen] = useState(false)

//   // const [loading, setLoading] = useState(false)

//   // Refs
//   const anchorRef = useRef<HTMLDivElement>(null)

//   // Hooks
//   const router = useRouter()

//   const { settings } = useSettings()

//   const handleDropdownOpen = () => {
//     !open ? setOpen(true) : setOpen(false)
//   }

//   const handleDropdownClose = (event?: MouseEvent<HTMLLIElement> | (MouseEvent | TouchEvent), url?: string) => {
//     if (url) {
//       router.push(url)
//     }

//     if (anchorRef.current && anchorRef.current.contains(event?.target as HTMLElement)) {
//       return
//     }

//     setOpen(false)
//   }

//   // const handleUserLogout = async () => {
//   //   try {
//   //     setLoading(true)
//   //     const responseData: any = await fetchData('/auth/logout', 'POST')
//   //     if (responseData.success) {
//   //       router.push('/login')
//   //     }
//   //   } catch (err) {
//   //     console.error(err)
//   //   } finally {
//   //     setLoading(false)
//   //   }
//   // }

//   const { mutate: logout, isPending } = useLogout()

//   return (
//     <>
//       <Badge
//         ref={anchorRef}
//         overlap='circular'
//         badgeContent={<BadgeContentSpan onClick={handleDropdownOpen} />}
//         anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
//         className='mis-2'
//       >
//         <Avatar
//           ref={anchorRef}
//           alt='John Doe'
//           src='/images/avatars/1.png'
//           onClick={handleDropdownOpen}
//           className='cursor-pointer bs-[38px] is-[38px]'
//         />
//       </Badge>
//       <Popper
//         open={open}
//         transition
//         disablePortal
//         placement='bottom-end'
//         anchorEl={anchorRef.current}
//         className='min-is-60 mbs-3! z-1'
//       >
//         {({ TransitionProps, placement }) => (
//           <Fade
//             {...TransitionProps}
//             style={{
//               transformOrigin: placement === 'bottom-end' ? 'right top' : 'left top'
//             }}
//           >
//             <Paper className={settings.skin === 'bordered' ? 'border shadow-none' : 'shadow-lg'}>
//               <ClickAwayListener onClickAway={e => handleDropdownClose(e as MouseEvent | TouchEvent)}>
//                 <MenuList>
//                   <div className='flex items-center plb-2 pli-6 gap-2' tabIndex={-1}>
//                     <Avatar alt='John Doe' src='/images/avatars/1.png' />
//                     <div className='flex items-start flex-col'>
//                       <Typography className='font-medium' color='text.primary'>
//                         John Doe
//                       </Typography>
//                       <Typography variant='caption'>admin@vuexy.com</Typography>
//                     </div>
//                   </div>
//                   <Divider className='mlb-1' />
//                   <MenuItem className='mli-2 gap-3' onClick={e => handleDropdownClose(e)}>
//                     <i className='tabler-user' />
//                     <Typography color='text.primary'>My Profile</Typography>
//                   </MenuItem>
//                   <MenuItem className='mli-2 gap-3' onClick={e => handleDropdownClose(e)}>
//                     <i className='tabler-settings' />
//                     <Typography color='text.primary'>Settings</Typography>
//                   </MenuItem>
//                   <MenuItem className='mli-2 gap-3' onClick={e => handleDropdownClose(e)}>
//                     <i className='tabler-currency-dollar' />
//                     <Typography color='text.primary'>Pricing</Typography>
//                   </MenuItem>
//                   <MenuItem className='mli-2 gap-3' onClick={e => handleDropdownClose(e)}>
//                     <i className='tabler-help-circle' />
//                     <Typography color='text.primary'>FAQ</Typography>
//                   </MenuItem>
//                   <div className='flex items-center plb-2 pli-3'>
//                     <Button
//                       fullWidth
//                       variant='contained'
//                       color='error'
//                       size='small'
//                       disabled={isPending}
//                       endIcon={<i className='tabler-logout' />}
//                       onClick={() => logout()}
//                       sx={{ '& .MuiButton-endIcon': { marginInlineStart: 1.5 } }}
//                     >
//                       {isPending ? 'Logging out...' : 'Logout'}
//                     </Button>
//                   </div>
//                 </MenuList>
//               </ClickAwayListener>
//             </Paper>
//           </Fade>
//         )}
//       </Popper>
//     </>
//   )
// }

// export default UserDropdown

// ── Helpers ───────────────────────────────────────────────────────────────

// ── Styled ────────────────────────────────────────────────────────────────
