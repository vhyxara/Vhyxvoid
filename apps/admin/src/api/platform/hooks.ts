'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { platformService } from './service'
import type { ListParams } from './types'

export const platformKeys = {
  all: ['platform'] as const,
  area: (area: string) => ['platform', area] as const,
  list: (area: string, params: ListParams) => ['platform', area, 'list', params] as const,
  detail: (area: string, id: string) => ['platform', area, 'detail', id] as const
}

/** Server-paginated list for one admin area. */
export function usePlatformList<T>(area: string, fetcher: (p: ListParams) => Promise<T>, params: ListParams) {
  return useQuery({
    queryKey: platformKeys.list(area, params),
    queryFn: () => fetcher(params),
    placeholderData: keepPreviousData
  })
}

export function usePlatformDetail<T>(area: string, id: string | undefined, fetcher: (id: string) => Promise<T>) {
  return useQuery({ queryKey: platformKeys.detail(area, id ?? ''), queryFn: () => fetcher(id!), enabled: !!id })
}

/** A write that refreshes every query of the listed areas afterwards. */
export function usePlatformMutation<TVars, TResult>(areas: string[], fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(areas.map(a => qc.invalidateQueries({ queryKey: platformKeys.area(a) })))
  })
}

export const useOverview = (days: number) => useQuery({ queryKey: [...platformKeys.area('overview'), days], queryFn: () => platformService.overview(days) })
export const useSystemHealth = () => useQuery({ queryKey: platformKeys.area('health'), queryFn: platformService.health, refetchOnWindowFocus: false, staleTime: 15_000 })
export const useSettings = () => useQuery({ queryKey: platformKeys.area('settings'), queryFn: platformService.settings })
