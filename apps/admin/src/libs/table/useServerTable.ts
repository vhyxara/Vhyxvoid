import { useMemo, useState } from 'react'

import type { SortingState } from '@tanstack/react-table'

import { usePersistedState } from './tableUtility'
import { useDebounce } from '@/utils/debouncedSearch'

type TableState = {
  page: number
  limit: number
  search: string
  sorting: SortingState
  filters: Record<string, string>
}

const DEFAULT_STATE: TableState = {
  page: 1,
  limit: 10,
  search: '',
  sorting: [],
  filters: {}
}

export function useServerTable(tableKey: string) {
  const { value: state, setValue: setState } = usePersistedState<TableState>(`table:${tableKey}`, DEFAULT_STATE)

  // Runtime-only UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debouncedSearch = useDebounce(state.search, 500)

  const sortBy = state.sorting[0]?.id || undefined

  const sortOrder: 'asc' | 'desc' | undefined =
    state.sorting.length === 0 ? undefined : state.sorting[0].desc ? 'desc' : 'asc'

  const params = useMemo(
    () => ({
      page: state.page,
      limit: state.limit,
      search: debouncedSearch,
      sortBy,
      sortOrder,
      filters: state.filters
    }),
    [state.page, state.limit, debouncedSearch, sortBy, sortOrder, state.filters]
  )

  const setPage = (page: number) => setState(prev => ({ ...prev, page }))
  const setLimit = (limit: number) => setState(prev => ({ ...prev, limit, page: 1 }))
  const setSearch = (search: string) => setState(prev => ({ ...prev, search, page: 1 }))

  const setSorting = (updater: SortingState | ((old: SortingState) => SortingState)) =>
    setState(prev => ({
      ...prev,
      sorting: typeof updater === 'function' ? updater(prev.sorting) : updater
    }))

  const setFilters = (filters: Record<string, string>) => setState(prev => ({ ...prev, filters, page: 1 }))

  const reset = () => {
    setState(DEFAULT_STATE)
    setLoading(false)
    setError(null)
  }

  return {
    ...state,
    params,

    // Persisted setters
    setPage,
    setLimit,
    setSearch,
    setSorting,
    setFilters,

    // Runtime lifecycle state
    loading,
    setLoading,
    error,
    setError,
    reset
  }
}
