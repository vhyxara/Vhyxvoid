// export type NotificationType =
//   | 'EMAIL_VERIFICATION'
//   | 'ACCOUNT_INVITATION'
//   | 'MEMBER_JOINED'
//   | 'MEMBER_REMOVED'
//   | 'ROLE_CHANGED'
//   | 'PAYMENT_FAILED'
//   | 'PAYMENT_SUCCEEDED'
//   | 'SUBSCRIPTION_CANCELED'
//   | 'TRIAL_ENDING'
//   | 'TUNNEL_DISCONNECTED'
//   | 'SYSTEM_ALERT'
//   | 'PASSWORD_RESET'
//   | string // extensible

// export type Notification = {
//   id: string
//   type: NotificationType
//   title: string
//   message: string
//   isRead: boolean
//   createdAt: string
//   metadata: Record<string, unknown> | null
// }

// export type NotificationsResult = {
//   notifications: Notification[]
//   unreadCount: number
//   total: number
// }

// export type ListNotificationsParams = {
//   limit?: number
//   offset?: number
//   unreadOnly?: boolean
// }
// Rename your type to AppNotification to avoid clashing with browser's Notification API

export type NotificationType =
  | 'EMAIL_VERIFICATION'
  | 'ACCOUNT_INVITATION'
  | 'MEMBER_JOINED'
  | 'MEMBER_REMOVED'
  | 'ROLE_CHANGED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_SUCCEEDED'
  | 'SUBSCRIPTION_CANCELED'
  | 'TRIAL_ENDING'
  | 'TUNNEL_DISCONNECTED'
  | 'SYSTEM_ALERT'
  | 'PASSWORD_RESET'
  | string

export type AppNotification = {
  id: string
  type: NotificationType
  title: string

  // Real, pre-existing bug found via this session's functional check against
  // the actual backend: the API (apps/api's GetNotifications use case) has
  // always returned this field as `body`, never `message` — confirmed by
  // reading the use case's return type directly, no `message` field exists
  // anywhere in the response. `message` silently rendered as `undefined` in
  // every notification row since this feature shipped, MUI version included
  // (this migration only surfaced it, it didn't cause it). Fixed here since
  // it's a one-field, single-consumer rename with zero ambiguity about the
  // correct fix — see decision.md, 2026-09-16, "Phase 3 part 1".
  body: string
  isRead: boolean
  createdAt: string
  metadata: Record<string, unknown> | null
}

export type NotificationsResult = {
  notifications: AppNotification[]
  unreadCount: number
  total: number
}

export type ListNotificationsParams = {
  limit?: number
  offset?: number
  unreadOnly?: boolean
}
