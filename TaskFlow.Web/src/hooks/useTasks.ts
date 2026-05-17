import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getApiV1TaskItems,
  getTaskV1,
  postApiV1TaskItems,
  putApiV1TaskItemsById,
  deleteApiV1TaskItemsById,
} from '@/api/client/sdk.gen'
import type { CreateTaskItemDto, UpdateTaskItemDto } from '@/api/client/types.gen'
import { getTaskHistory } from '@/api/tasks'

export const taskKeys = {
  all: ['tasks'] as const,
  detail: (id: number) => ['tasks', id] as const,
  history: (id: number) => ['tasks', id, 'history'] as const,
}

export function useTasksQuery() {
  return useQuery({
    queryKey: taskKeys.all,
    queryFn: () => getApiV1TaskItems(),
  })
}

export function useTaskQuery(id: number) {
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => getTaskV1({ path: { id } }),
    enabled: Number.isFinite(id),
  })
}

export function useTaskHistoryQuery(id: number) {
  return useQuery({
    queryKey: taskKeys.history(id),
    queryFn: () => getTaskHistory(id),
    enabled: Number.isFinite(id),
  })
}

export function useCreateTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateTaskItemDto) => postApiV1TaskItems({ body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

export function useUpdateTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateTaskItemDto }) =>
      putApiV1TaskItemsById({ path: { id }, body: data }),
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: taskKeys.all })
      qc.invalidateQueries({ queryKey: taskKeys.detail(id) })
    },
  })
}

export function useDeleteTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteApiV1TaskItemsById({ path: { id } }),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: taskKeys.all })
      qc.removeQueries({ queryKey: taskKeys.detail(id) })
    },
  })
}
