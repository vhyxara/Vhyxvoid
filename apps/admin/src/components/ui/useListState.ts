'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * Page, search and filters for a server-paginated list, kept in the URL so
 * links (and the global search box) open a pre-filtered list and the back
 * button works. Search input is debounced before it hits the URL.
 */
export function useListState(filterKeys: string[] = [], defaults: { limit?: number } = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [searchInput, setSearchInput] = useState(sp.get('search') ?? '')

  const params = useMemo(() => {
    const p: Record<string, string | number> = {
      page: Number(sp.get('page') ?? 1) || 1,
      limit: Number(sp.get('limit') ?? defaults.limit ?? 20) || 20
    }
    const search = sp.get('search')

    if (search) p.search = search
    for (const k of filterKeys) {
      const v = sp.get(k)

      if (v) p[k] = v
    }

    return p
  }, [sp, filterKeys, defaults.limit])

  const set = useCallback(
    (changes: Record<string, string | number | undefined | null>, resetPage = true) => {
      const next = new URLSearchParams(sp.toString())

      for (const [k, v] of Object.entries(changes)) {
        if (v === undefined || v === null || v === '') next.delete(k)
        else next.set(k, String(v))
      }
      if (resetPage && !('page' in changes)) next.delete('page')
      router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false })
    },
    [sp, router, pathname]
  )

  useEffect(() => {
    setSearchInput(sp.get('search') ?? '')
  }, [sp])

  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get('search') ?? '') !== searchInput) set({ search: searchInput })
    }, 350)

    return () => clearTimeout(t)
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

  return { params, set, searchInput, setSearchInput }
}
