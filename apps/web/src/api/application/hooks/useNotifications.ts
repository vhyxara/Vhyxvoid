import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'

// AppNotification,
import type { ListNotificationsParams, NotificationsResult } from '@/api/domain/notification/notification.types'
import { notificationKeys } from '@/api/infrastructure/query-keys/notification.keys'
import { notificationService } from '@/api/infrastructure/services/notification.service'
import { useBootstrapReady } from './useBootstrapSession'

/**
 * Fetch notifications list + unread count.
 * Refetches every 60s — keeps bell badge fresh without websockets.
 */
export function useNotifications(params?: ListNotificationsParams) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => notificationService.list(params),
    enabled: ready,
    staleTime: 30_000,
    refetchInterval: 60_000
  })
}

/**
 * Shortcut — just the unread count for the bell badge.
 * Shares the same cache entry as useNotifications().
 */
export function useUnreadCount(params?: ListNotificationsParams) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => notificationService.list(params),
    select: (data: NotificationsResult) => data.unreadCount,
    staleTime: 30_000,
    refetchInterval: 60_000
  })
}

/**
 * Mark a single notification as read.
 * Optimistic update — flips isRead immediately, rolls back on error.
 */
export function useMarkRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (notificationId: string) => notificationService.markRead(notificationId),

    onMutate: async notificationId => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all() })

      const previous = queryClient.getQueriesData<NotificationsResult>({
        queryKey: notificationKeys.all()
      })

      queryClient.setQueriesData<NotificationsResult>({ queryKey: notificationKeys.all() }, old => {
        if (!old) return old

        return {
          ...old,
          unreadCount: Math.max(0, old.unreadCount - 1),
          notifications: old.notifications.map(n => (n.id === notificationId ? { ...n, isRead: true } : n))
        }
      })

      return { previous }
    },

    onError: (_err, _id, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data))
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all() })
    }
  })
}

/**
 * Mark all notifications as read.
 * Optimistic update — zeros unreadCount and flips all isRead immediately.
 */
export function useMarkAllRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => notificationService.markAllRead(),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all() })

      const previous = queryClient.getQueriesData<NotificationsResult>({
        queryKey: notificationKeys.all()
      })

      queryClient.setQueriesData<NotificationsResult>({ queryKey: notificationKeys.all() }, old => {
        if (!old) return old

        return {
          ...old,
          unreadCount: 0,
          notifications: old.notifications.map(n => ({ ...n, isRead: true }))
        }
      })

      return { previous }
    },

    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data))
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all() })
    }
  })
}
