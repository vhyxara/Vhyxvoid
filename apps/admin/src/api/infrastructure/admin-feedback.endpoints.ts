// Real paths confirmed by reading feedback.routes.ts directly and via
// curl. adminFeedbackRoutes is registered at /api/v1/admin/feedback --
// a SEPARATE top-level prefix from every other admin route in this app
// (which all live under /api/v1/admin/identity), confirmed by reading
// identity/presentation/http/index.ts's route registration list directly.
export const ADMIN_FEEDBACK_ENDPOINTS = {
  LIST: '/admin/feedback',
  DETAIL: (id: string) => `/admin/feedback/${id}`,
  UPDATE: (id: string) => `/admin/feedback/${id}`
} as const
