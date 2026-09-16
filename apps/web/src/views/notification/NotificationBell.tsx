'use client'

import { Badge, Button, Popover, Separator, Tooltip } from '@vhyxui/react'

import { Skeleton, Typography } from '@/components/vhyxui-shims'
import { useSettings } from '@core/hooks/useSettings'
import type { AppNotification, NotificationType } from '@/api/domain/notification/notification.types'
import { useNotifications, useMarkRead, useMarkAllRead } from '@/api/application/hooks/useNotifications'

import styles from './NotificationBell.module.css'

// ── Type → icon + color map (unchanged from the MUI version — literal hex
// values, not MUI theme tokens, so nothing here needed to change) ──────────

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

// ── Time formatting (unchanged) ───────────────────────────────────────────

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
    <div
      onClick={() => !notification.isRead && onMarkRead(notification.id)}
      className={styles.row}
      data-unread={!notification.isRead}
    >
      {/* Icon circle — the `${meta.color}18` tint is a literal hex+alpha
          string, not a design token, so it stays an inline style either way */}
      <div className={styles.rowIcon} style={{ backgroundColor: `${meta.color}18` }}>
        <i className={meta.icon} style={{ color: meta.color, fontSize: 16 }} />
      </div>

      {/* Content */}
      <div className={styles.rowContent}>
        <Typography
          variant='body2'
          style={{
            fontWeight: notification.isRead ? 400 : 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {notification.title}
        </Typography>
        <Typography
          variant='caption'
          style={{
            color: 'var(--vhyx-color-text-subtle)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {notification.body}
        </Typography>
        <Typography
          variant='caption'
          style={{ color: 'var(--vhyx-color-text-disabled)', marginTop: 2, display: 'block' }}
        >
          {timeAgo(notification.createdAt)}
        </Typography>
      </div>

      {/* Unread dot */}
      {!notification.isRead && <span className={styles.unreadDot} />}
    </div>
  )
}

// ── Skeleton loading ──────────────────────────────────────────────────────

function NotificationSkeleton() {
  return (
    <div className='flex flex-col'>
      {[1, 2, 3].map(i => (
        <div key={i} className={styles.skeletonRow}>
          <Skeleton variant='circular' width={36} height={36} />
          <div style={{ flex: 1 }}>
            <Skeleton variant='text' width='60%' height={18} />
            <Skeleton variant='text' width='90%' height={14} />
            <Skeleton variant='text' width='30%' height={12} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Bell component ────────────────────────────────────────────────────────

export function NotificationBell() {
  const { settings } = useSettings()

  const { data, isLoading } = useNotifications({ limit: 20 })
  const unreadCount = data?.unreadCount ?? 0
  const notifications = data?.notifications ?? []

  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()

  // Same skin variable Login/Register/ForgotPassword/ResetPassword still
  // read post-migration. VhyxUI's Popover.Content always has a visible
  // border (unlike MUI's default-elevation Paper), so "bordered skin"
  // is adapted here to mean "drop the shadow" rather than "add a border" —
  // the closest equivalent behavior, not a literal 1:1 port.
  const panelClassName = settings.skin === 'bordered' ? `${styles.panel} ${styles.bordered}` : styles.panel

  return (
    <Popover>
      {/* Popover.Trigger renders a plain <button> — Tooltip's cloneElement
          composes cleanly on top of it (both set a ref via the same
          forwardRef mechanism; Popover's own ref-setting still runs). */}
      <Tooltip content='Notifications'>
        <Popover.Trigger className={styles.trigger} aria-label='Notifications'>
          <i className='tabler-bell text-xl' />
          {unreadCount > 0 && (
            <span className={styles.badgeWrap}>
              <Badge variant='danger' size='sm'>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            </span>
          )}
        </Popover.Trigger>
      </Tooltip>

      {/* side='bottom' align='end' matches the original placement='bottom-end',
          same choice UserDropdown already made for the same top-right
          icon-cluster position. Width is set inline (380px, matching the
          original) since it must beat Popover.Content's own default
          max-width (20rem/320px) — a genuine conflict, not just a
          cosmetic default, so only an inline style is guaranteed to win
          regardless of stylesheet load order. */}
      <Popover.Content side='bottom' align='end' className={panelClassName} style={{ width: 380, maxWidth: 380 }}>
        {/* ── Header ── */}
        <div className={styles.header}>
          <div className='flex items-center gap-2'>
            <Typography variant='subtitle1' style={{ fontWeight: 600 }}>
              Notifications
            </Typography>
            {unreadCount > 0 && (
              <Badge variant='danger' size='sm'>
                {unreadCount}
              </Badge>
            )}
          </div>

          {unreadCount > 0 && (
            <Tooltip content='Mark all as read'>
              <Button
                variant='ghost'
                size='sm'
                iconOnly
                aria-label='Mark all as read'
                loading={markAllRead.isPending}
                icon={<i className='tabler-checks text-sm' />}
                onClick={() => markAllRead.mutate()}
              />
            </Tooltip>
          )}
        </div>

        {/* ── List ── */}
        <div className={styles.list}>
          {isLoading ? (
            <NotificationSkeleton />
          ) : notifications.length === 0 ? (
            <div className={styles.empty}>
              <i
                className='tabler-bell-off'
                style={{
                  fontSize: 40,
                  color: 'var(--vhyx-color-text-disabled)',
                  display: 'block',
                  marginBottom: 8
                }}
              />
              <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
                You&apos;re all caught up
              </Typography>
            </div>
          ) : (
            notifications.map((notification: AppNotification, index) => (
              <div key={notification.id}>
                <NotificationRow notification={notification} onMarkRead={id => markRead.mutate(id)} />
                {index < notifications.length - 1 && <Separator style={{ margin: 0 }} />}
              </div>
            ))
          )}
        </div>

        {/* ── Footer ──
            A native <button> via Popover.Close (closes the panel, matching
            the original's handleClose-on-click), not a real navigation —
            "View all notifications" had no real target in the MUI version
            either. Same "reproduce the pre-existing non-functional
            placeholder faithfully" call as UserDropdown's My Profile/
            Settings/Pricing/FAQ items. */}
        {notifications.length > 0 && (
          <div className={styles.footer}>
            <Popover.Close className={styles.footerButton}>
              View all notifications
              <i className='tabler-arrow-right text-sm' />
            </Popover.Close>
          </div>
        )}
      </Popover.Content>
    </Popover>
  )
}
