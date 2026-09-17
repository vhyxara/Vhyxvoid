import { useEffect, useMemo, useState } from 'react'

import type { RowSelectionState } from '@tanstack/react-table'

export function usePersistedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)

      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  return { value, setValue }
}

export function useBulkSelection<T extends { id: number | string }>(rows: T[], selection: RowSelectionState) {
  const selectedIds = useMemo(() => rows.filter(row => selection[row.id]).map(r => r.id), [rows, selection])

  return {
    selectedIds,
    isAnySelected: selectedIds.length > 0
  }
}

/**
 * Drops undefined/empty-string top-level entries from a params object before
 * it's used as a React Query key or sent to `fetchData`/a service call —
 * e.g. an unset `sortBy` or an empty `search` string. Extracted from
 * GenericServerTable's own former internal `useQuery` call so both the new
 * props-based table-query hooks (e.g. `useMembersTableList`) and
 * `useSelfFetchingServerTable` (the not-yet-converted tables' compat shim)
 * clean params identically. See TABLE_API_ARCHITECTURE_COMPARISON.md Part 3.
 */
export function cleanTableParams<T extends Record<string, unknown>>(params: T): T {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) as T
}
