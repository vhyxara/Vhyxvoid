// types/pagination.ts
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
