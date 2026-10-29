import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { filterPending, usePendingDeleteIds } from '@/hooks/useUndoableDelete'
import {
  getApiV1TaskItemsByTaskIdNotes,
  postApiV1TaskItemsByTaskIdNotes,
  putApiV1TaskItemsByTaskIdNotesById,
  deleteApiV1TaskItemsByTaskIdNotesById,
} from '@/api/client/sdk.gen'
import type { CreateNoteDto, NoteResponseDto, UpdateNoteDto } from '@/api/client/types.gen'

export const noteKeys = {
  all: (taskId: number) => ['tasks', taskId, 'notes'] as const,
}

export function useNotesQuery(taskId: number) {
  const { pendingKeys } = usePendingDeleteIds()
  const select = useCallback(
    (res: Awaited<ReturnType<typeof getApiV1TaskItemsByTaskIdNotes>>) => {
      const list = res.data as NoteResponseDto[] | undefined
      if (!list || pendingKeys.size === 0) return res
      return { ...res, data: filterPending('tasknote', list, pendingKeys) } as typeof res
    },
    [pendingKeys],
  )
  return useQuery({
    queryKey: noteKeys.all(taskId),
    queryFn: () => getApiV1TaskItemsByTaskIdNotes({ path: { taskId } }),
    enabled: Number.isFinite(taskId),
    select,
  })
}

export function useCreateNoteMutation(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateNoteDto) =>
      postApiV1TaskItemsByTaskIdNotes({ path: { taskId }, body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.all(taskId) }),
  })
}

export function useUpdateNoteMutation(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateNoteDto }) =>
      putApiV1TaskItemsByTaskIdNotesById({ path: { taskId, id }, body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.all(taskId) }),
  })
}

export function useDeleteNoteMutation(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      // The flag is passed per call (the client only rejects on HTTP errors when it is set).
      deleteApiV1TaskItemsByTaskIdNotesById({ path: { taskId, id }, throwOnError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.all(taskId) }),
  })
}
