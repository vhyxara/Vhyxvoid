import type { ListNotificationsParams, NotificationsResult } from '@/api/domain/notification/notification.types'
import { httpClient } from '@/api/wrapper/http'
import { buildQuery } from '@/utils/utility'
import { NOTIFICATION_ENDPOINTS } from '../endpoints/auth.endpoints'

export const notificationService = {
  /**
   * GET /notifications
   * Returns paginated notifications + unreadCount for bell badge.
   */
  list: (params?: ListNotificationsParams): Promise<NotificationsResult> => {
    const query = params ? `?${buildQuery(params).toString()}` : ''

    return httpClient({
      url: `${NOTIFICATION_ENDPOINTS.LIST}${query}`,
      method: 'GET'
    })
  },

  /**
   * PATCH /notifications/:notificationId/read
   * Mark a single notification as read. Returns 204.
   */
  markRead: (notificationId: string): Promise<void> =>
    httpClient({
      url: NOTIFICATION_ENDPOINTS.READ.replace(':notificationId', notificationId),
      method: 'PATCH',
      data: {}
    }),

  /**
   * PATCH /notifications/read-all
   * Mark all notifications as read. Returns 204.
   */
  markAllRead: (): Promise<void> =>
    httpClient({
      url: NOTIFICATION_ENDPOINTS.READ_ALL,
      method: 'PATCH',
      data: {}
    })
}
