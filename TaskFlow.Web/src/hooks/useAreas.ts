import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  createArea,
  deleteArea,
  getAreas,
  renameArea,
  reorderAreas,
  type AreaDeleteChoice,
  type AreaResponseDto,
} from '@/api/areas'
import { areaKeys } from '@/hooks/areaKeys'
import { projectKeys } from '@/hooks/projectKeys'

// Same freshness as project queries: areas carry project counts.
const AREA_STALE_TIME_MS = 5_000

type AreasResponse = Awaited<ReturnType<typeof getAreas>>

export function useAreasQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: areaKeys.all,
    queryFn: () => getAreas(),
    staleTime: AREA_STALE_TIME_MS,
    refetchOnMount: 'always',
    enabled,
  })
}

/** Rewrites the cached list; does nothing when no list has been loaded. */
function updateCachedAreas(qc: QueryClient, update: (areas: AreaResponseDto[]) => AreaResponseDto[]) {
  qc.setQueryData<AreasResponse>(areaKeys.all, old =>
    old?.data ? ({ ...old, data: update(old.data) } as AreasResponse) : old,
  )
}

/** Projects carry `areaName`, so area changes can make project data stale too. */
function invalidateAreasAndProjects(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: areaKeys.all }),
    qc.invalidateQueries({ queryKey: projectKeys.all }),
  ])
}

export function useCreateAreaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => createArea(name),
    onSuccess: result => {
      const created = result.data as AreaResponseDto
      updateCachedAreas(qc, areas => [...areas.filter(a => a.id !== created.id), created])
      void qc.invalidateQueries({ queryKey: areaKeys.all })
    },
  })
}

export function useRenameAreaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameArea(id, name),
    onSettled: () => invalidateAreasAndProjects(qc),
  })
}

/** Optimistic: the cached list takes the new order at once and is restored if the save fails. */
export function useReorderAreasMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (areaIds: number[]) => reorderAreas(areaIds),
    onMutate: async areaIds => {
      await qc.cancelQueries({ queryKey: areaKeys.all })
      const snapshot = qc.getQueryData<AreasResponse>(areaKeys.all)
      updateCachedAreas(qc, areas =>
        areaIds.flatMap(id => areas.filter(a => a.id === id)),
      )
      return { snapshot }
    },
    onError: (_error, _areaIds, context) => {
      if (context?.snapshot) qc.setQueryData(areaKeys.all, context.snapshot)
    },
    // Also reloads the list when the save was rejected because areas changed elsewhere.
    onSettled: () => qc.invalidateQueries({ queryKey: areaKeys.all }),
  })
}

export function useDeleteAreaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, choice }: { id: number; choice?: AreaDeleteChoice }) => deleteArea(id, choice),
    onSuccess: (_result, { id }) => {
      updateCachedAreas(qc, areas => areas.filter(a => a.id !== id))
      return invalidateAreasAndProjects(qc)
    },
    onError: () => invalidateAreasAndProjects(qc),
  })
}
