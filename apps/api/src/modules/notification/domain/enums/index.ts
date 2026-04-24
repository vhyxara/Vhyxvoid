// src/modules/notifications/domain/enums/index.ts

export enum NotificationType {
  EMAIL_VERIFICATION    = 'EMAIL_VERIFICATION',
  PASSWORD_RESET        = 'PASSWORD_RESET',
  ACCOUNT_INVITATION    = 'ACCOUNT_INVITATION',
  MEMBER_JOINED         = 'MEMBER_JOINED',
  MEMBER_REMOVED        = 'MEMBER_REMOVED',
  ROLE_CHANGED          = 'ROLE_CHANGED',
  PAYMENT_FAILED        = 'PAYMENT_FAILED',
  PAYMENT_SUCCEEDED     = 'PAYMENT_SUCCEEDED',
  SUBSCRIPTION_CANCELED = 'SUBSCRIPTION_CANCELED',
  TRIAL_ENDING          = 'TRIAL_ENDING',
  TUNNEL_DISCONNECTED   = 'TUNNEL_DISCONNECTED',
  SYSTEM_ALERT          = 'SYSTEM_ALERT',
}

export enum NotificationChannel {
  EMAIL  = 'EMAIL',
  IN_APP = 'IN_APP',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT    = 'SENT',
  FAILED  = 'FAILED',
  READ    = 'READ',
}
