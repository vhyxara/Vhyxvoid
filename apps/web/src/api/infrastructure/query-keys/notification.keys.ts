import type { ListNotificationsParams } from '@/api/domain/notification/notification.types'

export const notificationKeys = {
  all: () => ['notifications'] as const,
  list: (params?: ListNotificationsParams) => ['notifications', 'list', params] as const
}
