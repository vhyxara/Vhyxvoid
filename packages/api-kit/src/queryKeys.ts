/**
 * Hierarchical query keys. Invalidating `all` matches every list and detail;
 * `lists()` matches every parameterized `list(params)`.
 */
export function createQueryKeys<TParams = Record<string, unknown>>(base: string) {
  const all = [base] as const

  return {
    all,
    lists: () => [base, 'list'] as const,
    list: (params?: TParams) => (params === undefined ? ([base, 'list'] as const) : ([base, 'list', params] as const)),
    details: () => [base, 'detail'] as const,
    detail: (id: string | number) => [base, 'detail', id] as const
  }
}

export type QueryKeys<TParams = Record<string, unknown>> = ReturnType<typeof createQueryKeys<TParams>>
