export const AUTH_ENDPOINTS = {
  LOGIN: '/auth/login',
  REGISTER: '/auth/register',
  LOGOUT: '/auth/logout',
  LOGOUT_ALL: '/auth/logout-all',
  REFRESH: '/auth/refresh',
  VERIFY_EMAIL: '/auth/verify-email',
  FORGOT_PASSWORD: '/auth/forgot-password',
  RESET_PASSWORD: '/auth/reset-password',
  CHANGE_PASSWORD: '/account/me/password'
} as const

export const NOTIFICATION_ENDPOINTS = {
  LIST: '/notification/notifications',
  READ: '/notification/notifications/:notificationId/read',
  READ_ALL: '/notification/notifications/read-all'
} as const
