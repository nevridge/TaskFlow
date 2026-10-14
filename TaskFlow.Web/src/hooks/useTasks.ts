import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getApiV1TaskItems,
  getTaskV1,
  postApiV1TaskItems,
  putApiV1TaskItemsById,
  deleteApiV1TaskItemsById,
} from '@/api/client/sdk.gen'
import type { CreateTaskItemDto, TaskItemResponseDto, UpdateTaskItemDto } from '@/api/client/types.gen'
import { getTaskHistory } from '@/api/tasks'
import { projectKeys } from '@/hooks/projectKeys'

export type TaskItemViewModel = TaskItemResponseDto & {
  currentJournalEntryId?: number | null
  currentJournalDate?: string | null
  firstTaggedDate?: string | null
  lastMovedDate?: string | null
  daysTagged?: number
  moveCount?: number
  isScheduledFuture?: boolean
  parentTaskItemId?: number | null
  childTaskCount?: number
}

export type CreateTaskPayload = CreateTaskItemDto & {
  parentTaskItemId?: number | null
  journalDate?: string | null
}

export type UpdateTaskPayload = UpdateTaskItemDto & {
  parentTaskItemId?: number | null
  autoCompleteParentWhenChildrenDone?: boolean
}

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
    mutationFn: (data: CreateTaskPayload) =>
      postApiV1TaskItems({
        body: {
          title: data.title,
          description: data.description,
          status: data.status,
          isComplete: data.isComplete,
          priority: data.priority,
          dueDate: data.dueDate,
          parentTaskItemId: data.parentTaskItemId ?? null,
          journalDate: data.journalDate ?? null,
          projectId: data.projectId ?? null,
        } as CreateTaskItemDto,
      }),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: taskKeys.all })
      if (variables.projectId != null) qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useUpdateTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateTaskPayload }) =>
      putApiV1TaskItemsById({
        path: { id },
        // Intentionally no projectId: UpdateTaskItemDto has none, and PUT is a full
        // replace that must never clear the project. Project changes go through the
        // assign/unassign endpoints (see useChangeTaskProject).
        body: {
          title: data.title,
          description: data.description,
          status: data.status,
          isComplete: data.isComplete,
          priority: data.priority,
          dueDate: data.dueDate,
          parentTaskItemId: data.parentTaskItemId ?? null,
          autoCompleteParentWhenChildrenDone: data.autoCompleteParentWhenChildrenDone ?? false,
        } as UpdateTaskItemDto,
      }),
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: taskKeys.all })
      qc.invalidateQueries({ queryKey: taskKeys.detail(id) })
      // Status changes alter the open/completed counts shown on project views.
      qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useDeleteTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteApiV1TaskItemsById({ path: { id } }),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: taskKeys.all })
      qc.invalidateQueries({ queryKey: projectKeys.all })
      qc.removeQueries({ queryKey: taskKeys.detail(id) })
    },
  })
}
