// Copied from apps/web/src/api/types/pagination.ts -- the shape apps/web's
// `tableResponse()` helper (apps/api's core/utils/response.util.ts) sends
// for every genuinely server-paginated endpoint: `items`/`meta`/`extra` at
// the TOP LEVEL, no `data` wrapper. `createHttpClient`'s default
// `unwrapResponse` only unwraps a `.data` key, so a response shaped like
// this comes back as the whole envelope (including `success`/`message`) --
// confirmed via a real curl call against GET /admin/feedback, apps/admin's
// first endpoint to use this shape. Feedback is the one screen in this app
// whose backend genuinely matches this contract (real page/limit/total),
// unlike Users/Roles/Abilities (no server pagination at all) or Audit Log
// (real limit/offset but no total).
export type PaginationMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type PaginatedResponse<TData, TExtra = unknown> = {
  success: boolean
  message: string
  items: TData[]
  meta: PaginationMeta
  extra?: TExtra
}
