'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { inspectorService } from '@/api/infrastructure/services/inspector.service'
import { useBootstrapReady } from './useBootstrapSession'

export const inspectorKeys = {
  all: (accountId: string) => ['inspector', accountId] as const,
  overview: (accountId: string) => ['inspector', accountId, 'overview'] as const,
  list: (accountId: string, label: string) => ['inspector', accountId, 'list', label] as const,
  detail: (accountId: string, label: string, id: string) => ['inspector', accountId, 'detail', label, id] as const
}

export function useInspectorOverview(accountId: string, live: boolean) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: inspectorKeys.overview(accountId),
    queryFn: () => inspectorService.overview(accountId),
    enabled: ready && !!accountId,
    refetchInterval: live ? 5_000 : false
  })
}

export function useInspectorList(accountId: string, label: string | null, live: boolean) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: inspectorKeys.list(accountId, label ?? ''),
    queryFn: () => inspectorService.list(accountId, label!),
    enabled: ready && !!accountId && !!label,
    refetchInterval: live ? 3_000 : false,
    placeholderData: keepPreviousData
  })
}

export function useInspectedRequest(accountId: string, label: string | null, id: string | null) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: inspectorKeys.detail(accountId, label ?? '', id ?? ''),
    queryFn: () => inspectorService.detail(accountId, label!, id!),
    enabled: ready && !!accountId && !!label && !!id,
    staleTime: Infinity // a captured request never changes
  })
}

export function useReplayRequest(accountId: string, label: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => inspectorService.replay(accountId, label, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectorKeys.list(accountId, label) })
  })
}

export function useClearInspector(accountId: string, label: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: () => inspectorService.clear(accountId, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectorKeys.all(accountId) })
  })
}
