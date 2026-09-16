'use client'
import { useRef, useState } from 'react'

// import { useRouter } from 'next/navigation'

// import { styled } from '@mui/material/styles'
import Badge from '@mui/material/Badge'
import IconButton from '@mui/material/IconButton'
import Popper from '@mui/material/Popper'
import Fade from '@mui/material/Fade'
import Paper from '@mui/material/Paper'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'

import { useSettings } from '@core/hooks/useSettings'
import type { AppNotification, NotificationType } from '@/api/domain/notification/notification.types'
import { useNotifications, useMarkRead, useMarkAllRead } from '@/api/application/hooks/useNotifications'

// ── Type → icon + color map ───────────────────────────────────────────────

type NotificationMeta = { icon: string; color: string }

function getNotificationMeta(type: NotificationType): NotificationMeta {
  const map: Record<string, NotificationMeta> = {
    EMAIL_VERIFICATION: { icon: 'tabler-mail-check', color: '#3b82f6' },
    ACCOUNT_INVITATION: { icon: 'tabler-user-plus', color: '#8b5cf6' },
    MEMBER_JOINED: { icon: 'tabler-user-check', color: '#22c55e' },
    MEMBER_REMOVED: { icon: 'tabler-user-minus', color: '#f97316' },
    ROLE_CHANGED: { icon: 'tabler-shield-check', color: '#06b6d4' },
    PAYMENT_FAILED: { icon: 'tabler-credit-card-off', color: '#ef4444' },
    PAYMENT_SUCCEEDED: { icon: 'tabler-credit-card', color: '#22c55e' },
    SUBSCRIPTION_CANCELED: { icon: 'tabler-receipt-off', color: '#ef4444' },
    TRIAL_ENDING: { icon: 'tabler-clock-exclamation', color: '#f59e0b' },
    TUNNEL_DISCONNECTED: { icon: 'tabler-plug-x', color: '#ef4444' },
    SYSTEM_ALERT: { icon: 'tabler-alert-triangle', color: '#f59e0b' },
    PASSWORD_RESET: { icon: 'tabler-lock-check', color: '#8b5cf6' }
  }

  return map[type] ?? { icon: 'tabler-bell', color: '#94a3b8' }
}

// ── Time formatting ───────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)

  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Single notification row ───────────────────────────────────────────────

function NotificationRow({
  notification,
  onMarkRead
}: {
  notification: AppNotification
  onMarkRead: (id: string) => void
}) {
  const meta = getNotificationMeta(notification.type)

  return (
    <Box
      onClick={() => !notification.isRead && onMarkRead(notification.id)}
      sx={{
        display: 'flex',
        gap: 1.5,
        px: 2,
        py: 1.5,
        cursor: notification.isRead ? 'default' : 'pointer',
        bgcolor: notification.isRead ? 'transparent' : 'action.hover',
        transition: 'background-color 0.15s',
        '&:hover': { bgcolor: 'action.selected' },
        position: 'relative'
      }}
    >
      {/* Icon circle */}
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          bgcolor: `${meta.color}18`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          mt: 0.25
        }}
      >
        <i className={meta.icon} style={{ color: meta.color, fontSize: 16 }} />
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant='body2'
          fontWeight={notification.isRead ? 400 : 600}
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {notification.title}
        </Typography>
        <Typography
          variant='caption'
          color='text.secondary'
          sx={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {notification.message}
        </Typography>
        <Typography variant='caption' color='text.disabled' sx={{ mt: 0.25, display: 'block' }}>
          {timeAgo(notification.createdAt)}
        </Typography>
      </Box>

      {/* Unread dot */}
      {!notification.isRead && (
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            flexShrink: 0,
            mt: 0.75
          }}
        />
      )}
    </Box>
  )
}

// ── Skeleton loading ──────────────────────────────────────────────────────

function NotificationSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {[1, 2, 3].map(i => (
        <Box key={i} sx={{ display: 'flex', gap: 1.5, px: 2, py: 1.5 }}>
          <Skeleton variant='circular' width={36} height={36} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant='text' width='60%' height={18} />
            <Skeleton variant='text' width='90%' height={14} />
            <Skeleton variant='text' width='30%' height={12} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// ── Bell component ────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const { settings } = useSettings()

  const { data, isLoading } = useNotifications({ limit: 20 })
  const unreadCount = data?.unreadCount ?? 0
  const notifications = data?.notifications ?? []

  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()

  const handleToggle = () => setOpen(prev => !prev)
  const handleClose = () => setOpen(false)

  return (
    <>
      {/* ── Bell button ── */}
      <Tooltip title='Notifications'>
        <IconButton ref={anchorRef} onClick={handleToggle} size='small' sx={{ position: 'relative' }}>
          <Badge
            badgeContent={unreadCount > 99 ? '99+' : unreadCount}
            color='error'
            max={99}
            sx={{
              '& .MuiBadge-badge': {
                fontSize: 10,
                minWidth: 18,
                height: 18,
                fontWeight: 600
              }
            }}
          >
            <i className='tabler-bell text-xl' />
          </Badge>
        </IconButton>
      </Tooltip>

      {/* ── Dropdown ── */}
      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement='bottom-end'
        transition
        disablePortal
        className='z-1300'
        style={{ width: 380 }}
      >
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={200}>
            <Paper
              elevation={8}
              className={settings.skin === 'bordered' ? 'border shadow-none' : ''}
              sx={{ borderRadius: 3, overflow: 'hidden', mt: 1.5 }}
            >
              <ClickAwayListener onClickAway={handleClose}>
                <Box>
                  {/* ── Header ── */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      px: 2,
                      py: 1.5,
                      borderBottom: '1px solid',
                      borderColor: 'divider'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant='subtitle1' fontWeight={600}>
                        Notifications
                      </Typography>
                      {unreadCount > 0 && (
                        <Chip
                          label={unreadCount}
                          size='small'
                          color='error'
                          sx={{ height: 20, fontSize: 11, fontWeight: 600 }}
                        />
                      )}
                    </Box>

                    {unreadCount > 0 && (
                      <Tooltip title='Mark all as read'>
                        <IconButton size='small' onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
                          {markAllRead.isPending ? (
                            <CircularProgress size={16} />
                          ) : (
                            <i className='tabler-checks text-sm' />
                          )}
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>

                  {/* ── List ── */}
                  <Box
                    sx={{
                      maxHeight: 440,
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': { width: 4 },
                      '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                      '&::-webkit-scrollbar-thumb': {
                        bgcolor: 'action.disabled',
                        borderRadius: 2
                      }
                    }}
                  >
                    {isLoading ? (
                      <NotificationSkeleton />
                    ) : notifications.length === 0 ? (
                      <Box sx={{ py: 6, textAlign: 'center' }}>
                        <i
                          className='tabler-bell-off'
                          style={{
                            fontSize: 40,
                            color: 'var(--mui-palette-text-disabled)',
                            display: 'block',
                            marginBottom: 8
                          }}
                        />
                        <Typography variant='body2' color='text.secondary'>
                          You&apos;re all caught up
                        </Typography>
                      </Box>
                    ) : (
                      notifications.map((notification: AppNotification, index) => (
                        <Box key={notification.id}>
                          <NotificationRow notification={notification} onMarkRead={id => markRead.mutate(id)} />
                          {index < notifications.length - 1 && <Divider sx={{ mx: 2 }} />}
                        </Box>
                      ))
                    )}
                  </Box>

                  {/* ── Footer ── */}
                  {notifications.length > 0 && (
                    <Box
                      sx={{
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        px: 2,
                        py: 1,
                        textAlign: 'center'
                      }}
                    >
                      <Button
                        size='small'
                        variant='text'
                        fullWidth
                        endIcon={<i className='tabler-arrow-right text-sm' />}
                        onClick={handleClose}
                      >
                        View all notifications
                      </Button>
                    </Box>
                  )}
                </Box>
              </ClickAwayListener>
            </Paper>
          </Fade>
        )}
      </Popper>
    </>
  )
}
