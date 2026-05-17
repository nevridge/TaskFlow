import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getJournalEntries,
  createJournalEntry,
  updateJournalEntry,
  getJournalTodos,
  removeJournalTodo,
  createLogEntry,
  deleteLogEntry,
} from '@/api/journal'
import type { JournalEntryResponseDto, TaskItemResponseDto } from '@/api/journal'
import { postApiV1TaskItems, putApiV1TaskItemsById } from '@/api/client/sdk.gen'
import { taskKeys } from '@/hooks/useTasks'
import { addDays, formatEntryTitle } from '@/lib/journal-utils'
import { usePrefs } from '@/context/usePrefs'

export const journalKeys = {
  all: ['journal'] as const,
  todos: (entryId: number) => ['journal', entryId, 'todos'] as const,
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

// ─── Journal entry mutations ──────────────────────────────────────────────────

export function useUpdateNotesMutation(entryId: number, entryTitle: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (summary: string) =>
      updateJournalEntry(entryId, { title: entryTitle, summary }),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalKeys.all }),
  })
}

// ─── Todo mutations ───────────────────────────────────────────────────────────

export function useCreateTodoMutation(entryId: number, isoDate: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (title: string) =>
      postApiV1TaskItems({ body: { title, status: 'todo', journalDate: isoDate } }),
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
    mutationFn: ({ id, title, done }: { id: number; title: string; done: boolean }) =>
      putApiV1TaskItemsById({
        path: { id },
        body: {
          title,
          status: done ? 'completed' : 'todo',
          autoCompleteParentWhenChildrenDone,
        },
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
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      putApiV1TaskItemsById({
        path: { id },
        body: { title, autoCompleteParentWhenChildrenDone },
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
