import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getJournalEntries,
  createJournalEntry,
  getJournalTodos,
  removeJournalTodo,
  createLogEntry,
  deleteLogEntry,
  getJournalNotes,
  createJournalNote,
  updateJournalNote,
  deleteJournalNote,
} from '@/api/journal'
import type { JournalEntryResponseDto, TaskItemResponseDto, JournalNoteResponseDto } from '@/api/journal'
import type { CreateTaskItemDto, UpdateTaskItemDto } from '@/api/client/types.gen'
import { postApiV1TaskItems, putApiV1TaskItemsById } from '@/api/client/sdk.gen'
import { taskKeys } from '@/hooks/useTasks'
import { addDays, formatEntryTitle } from '@/lib/journal-utils'
import { usePrefs } from '@/context/usePrefs'

export const journalKeys = {
  all: ['journal'] as const,
  todos: (entryId: number) => ['journal', entryId, 'todos'] as const,
  notes: (entryId: number) => ['journal', entryId, 'notes'] as const,
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useJournalEntries() {
  return useQuery({
    queryKey: journalKeys.all,
    queryFn: () => getJournalEntries(),
    staleTime: 30_000,
  })
}

export function useJournalTodos(entryId: number | undefined) {
  return useQuery({
    queryKey: journalKeys.todos(entryId ?? 0),
    queryFn: () => getJournalTodos(entryId!),
    enabled: entryId != null,
  })
}

/**
 * Finds the journal entry for a given ISO date. If none exists after the
 * entries query settles, auto-creates one with the date as the title.
 */
export function useEnsureJournalEntry(isoDate: string) {
  const entriesQuery = useJournalEntries()
  const qc = useQueryClient()
  const attemptedRef = useRef<string | null>(null)

  const entries = (entriesQuery.data?.data as JournalEntryResponseDto[] | undefined) ?? []
  const entry = entries.find(e => e.date === isoDate)

  const { mutate: createEntry, isPending: isCreating, error: createError } = useMutation({
    mutationFn: (date: string) =>
      createJournalEntry({ title: formatEntryTitle(date), date }),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalKeys.all }),
  })

  useEffect(() => {
    if (entriesQuery.isLoading || entriesQuery.isError) return
    if (entry) return
    if (attemptedRef.current === isoDate) return
    attemptedRef.current = isoDate
    createEntry(isoDate)
  }, [entriesQuery.isLoading, entriesQuery.isError, entry, isoDate, createEntry])

  return {
    entry,
    isLoading: entriesQuery.isLoading || isCreating,
    error: entriesQuery.error ?? createError,
  }
}

// ─── Journal notes queries and mutations ─────────────────────────────────────

export function useJournalNotes(entryId: number) {
  return useQuery({
    queryKey: journalKeys.notes(entryId),
    queryFn: () => getJournalNotes(entryId),
    select: (res) => (res.data as JournalNoteResponseDto[] | undefined) ?? [],
  })
}

export function useCreateJournalNoteMutation(entryId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => createJournalNote(entryId, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalKeys.notes(entryId) }),
  })
}

export function useUpdateJournalNoteMutation(entryId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      updateJournalNote(entryId, id, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalKeys.notes(entryId) }),
  })
}

export function useDeleteJournalNoteMutation(entryId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteJournalNote(entryId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalKeys.notes(entryId) }),
  })
}

// ─── Todo mutations ───────────────────────────────────────────────────────────

export function useCreateTodoMutation(entryId: number, isoDate: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (title: string) => {
      // Pass browser timezone offset in minutes (e.g. -420 for PDT)
      const timezoneOffsetMinutes = new Date().getTimezoneOffset() * -1;
      return postApiV1TaskItems({
        body: {
          title,
          status: 'todo',
          journalDate: isoDate,
          timezoneOffsetMinutes,
        } as CreateTaskItemDto,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journalKeys.todos(entryId) })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}

export function useToggleTodoMutation(entryId: number) {
  const qc = useQueryClient()
  const { autoCompleteParentWhenChildrenDone } = usePrefs()
  return useMutation({
    mutationFn: ({ id, title, done, parentTaskItemId }: { id: number; title: string; done: boolean; parentTaskItemId?: number | null }) =>
      putApiV1TaskItemsById({
        path: { id },
        body: {
          title,
          status: done ? 'completed' : 'todo',
          parentTaskItemId,
          autoCompleteParentWhenChildrenDone,
        } as UpdateTaskItemDto,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journalKeys.todos(entryId) })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}

export function useEditTodoMutation(entryId: number) {
  const qc = useQueryClient()
  const { autoCompleteParentWhenChildrenDone } = usePrefs()
  return useMutation({
    mutationFn: ({ id, title, parentTaskItemId }: { id: number; title: string; parentTaskItemId?: number | null }) =>
      putApiV1TaskItemsById({
        path: { id },
        body: { title, parentTaskItemId, autoCompleteParentWhenChildrenDone } as UpdateTaskItemDto,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journalKeys.todos(entryId) })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}

export function useRemoveTodoMutation(entryId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskItemId: number) => removeJournalTodo(entryId, taskItemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalKeys.todos(entryId) }),
  })
}

// ─── Log mutations ────────────────────────────────────────────────────────────

export function useAddLogEntryMutation(entryId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => createLogEntry(entryId, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalKeys.all }),
  })
}

export function useDeleteLogEntryMutation(entryId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (logId: number) => deleteLogEntry(entryId, logId),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalKeys.all }),
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Count open todos in a journal entry's todos list. */
export function openTodoCount(todos: TaskItemResponseDto[]): number {
  return todos.filter(t => t.status !== 'Completed' && !t.isComplete).length
}

/** ISO date of yesterday relative to a given ISO date. */
export function yesterdayOf(isoDate: string): string {
  return addDays(isoDate, -1)
}
