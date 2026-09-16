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
  message: string
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
