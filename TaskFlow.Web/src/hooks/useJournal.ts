import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import {
  getJournalEntries,
  createJournalEntry,
  carryForwardJournalEntry,
  getJournalTodos,
  removeJournalTodo,
  createLogEntry,
  deleteLogEntry,
  updateLogEntry,
  getJournalNotes,
  createJournalNote,
  updateJournalNote,
  deleteJournalNote,
} from '@/api/journal'
import type {
  JournalEntryResponseDto,
  JournalLogEntryResponseDto,
  TaskItemResponseDto,
  JournalNoteResponseDto,
} from '@/api/journal'
import type { CreateTaskItemDto } from '@/api/client/types.gen'
import { postApiV1TaskItems, patchApiV1TaskItemsById } from '@/api/client/sdk.gen'
import {
  taskKeys,
  useBlockTaskMutation,
  useUnblockTaskMutation,
  useEditBlockedReasonMutation,
  applyOptimisticTaskUpdate,
  rollbackTaskCache,
} from '@/hooks/useTasks'
import { journalKeys } from '@/hooks/journalKeys'
import { filterPending, pendingKey, usePendingDeleteIds } from '@/hooks/useUndoableDelete'
import { isBlocked, withBlockedCompleted } from '@/lib/task-status'
import { addDays, formatEntryTitle, getTimezoneOffsetMinutes, todayISO } from '@/lib/journal-utils'
import { usePrefs } from '@/context/usePrefs'

// Re-exported so existing imports from '@/hooks/useJournal' keep working.
export { journalKeys }

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useJournalEntries() {
  return useQuery({
    queryKey: journalKeys.all,
    queryFn: () => getJournalEntries(),
    staleTime: 30_000,
  })
}

/** Hides tasks whose Tasks-page delete is still inside the undo window (top-level and subtasks). */
export function useJournalTodos(entryId: number | undefined) {
  const { pendingKeys } = usePendingDeleteIds()
  const select = useCallback(
    (res: Awaited<ReturnType<typeof getJournalTodos>>) => {
      const list = res.data as TaskItemResponseDto[] | undefined
      if (!list || pendingKeys.size === 0) return res
      const visible = filterPending('task', list, pendingKeys).map(t =>
        t.children?.some(c => c.id != null && pendingKeys.has(pendingKey('task', c.id)))
          ? { ...t, children: filterPending('task', t.children, pendingKeys) }
          : t,
      )
      return { ...res, data: visible } as typeof res
    },
    [pendingKeys],
  )
  return useQuery({
    queryKey: journalKeys.todos(entryId ?? 0),
    queryFn: () => getJournalTodos(entryId!),
    enabled: entryId != null,
    select,
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

  const carriedRef = useRef<string | null>(null)
  const viewedRef = useRef<string | null>(null)

  const { mutate: createEntry, isPending: isCreating, error: createError } = useMutation({
    mutationFn: async (date: string) => {
      // Evaluated at call time (not render) so it stays correct across midnight.
      // Only today's entry carries tasks forward; other dates never send an offset.
      const isToday = date === todayISO()
      const res = await createJournalEntry(
        {
          title: formatEntryTitle(date),
          date,
          ...(isToday ? { timezoneOffsetMinutes: getTimezoneOffsetMinutes() } : {}),
        },
        { throwOnError: false },
      )
      // 409 means another client created the entry first: treat it like success. The 409 body has no
      // status field, so the status comes from the response. Other failures reject so onError runs.
      if (res.response?.status !== 409 && res.error !== undefined) throw res.error
      // A 409 returns before the server's carry-forward, so it never counts as an inline carry.
      return { res, date, carriedInline: isToday && res.response?.status !== 409 }
    },
    onSuccess: ({ date, carriedInline }) => {
      // The server carried inline for today, so no separate carry-forward call is needed.
      if (carriedInline) carriedRef.current = date
      // Always refresh tasks after an inline carry: a lost race reports movedCount 0 although another
      // request moved the tasks.
      if (carriedInline) qc.invalidateQueries({ queryKey: taskKeys.all })
      return qc.invalidateQueries({ queryKey: journalKeys.all })
    },
    // 409 (another client created it first): refetch so the entry appears.
    onError: () => qc.invalidateQueries({ queryKey: journalKeys.all }),
  })

  const { mutate: carryForward } = useMutation({
    mutationFn: ({ id }: { id: number }) =>
      carryForwardJournalEntry(id, getTimezoneOffsetMinutes()),
    onSuccess: (res) => {
      const moved = Number(res.data?.movedCount ?? 0)
      qc.invalidateQueries({ queryKey: journalKeys.all })
      if (moved > 0) qc.invalidateQueries({ queryKey: taskKeys.all })
    },
    // Fail silently: no retry. carriedRef stays set for this page session.
  })

  useEffect(() => {
    // A failed lookup still falls through to create: the server answers 409 if the entry exists.
    if (entriesQuery.isLoading) return
    if (entry) return
    if (attemptedRef.current === isoDate) return
    attemptedRef.current = isoDate
    createEntry(isoDate)
  }, [entriesQuery.isLoading, entry, isoDate, createEntry])

  const entryId = entry?.id
  useEffect(() => {
    // A date change counts as a new load.
    if (viewedRef.current !== isoDate) {
      viewedRef.current = isoDate
      carriedRef.current = null
    }
    if (entriesQuery.isLoading || entriesQuery.isError) return
    if (entryId == null) return
    if (isoDate !== todayISO()) return
    if (carriedRef.current === isoDate) return
    carriedRef.current = isoDate
    carryForward({ id: entryId })
  }, [entriesQuery.isLoading, entriesQuery.isError, entryId, isoDate, carryForward])

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
      const timezoneOffsetMinutes = getTimezoneOffsetMinutes();
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
    mutationFn: ({ id, done, autoCompleteParentWhenChildrenDone: overrideAutoComplete }: { id: number; done: boolean; autoCompleteParentWhenChildrenDone?: boolean }) =>
      patchApiV1TaskItemsById({
        path: { id },
        body: {
          status: done ? 'completed' : 'todo',
          autoCompleteParentWhenChildrenDone: overrideAutoComplete ?? autoCompleteParentWhenChildrenDone,
          timezoneOffsetMinutes: getTimezoneOffsetMinutes(),
        },
        throwOnError: true,
      }),
    // Completing a Blocked row clears its blocked fields right away; other toggles wait for the server.
    onMutate: ({ id, done }) =>
      done
        ? applyOptimisticTaskUpdate(
            qc,
            [journalKeys.todos(entryId), taskKeys.all],
            id,
            task => (isBlocked(task.status) ? withBlockedCompleted(task) : task),
          )
        : undefined,
    onError: (_err, _vars, snapshot) => rollbackTaskCache(qc, snapshot),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journalKeys.todos(entryId) })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}

/** Block a journal todo: optimistic, rolled back on failure. */
export function useBlockTodoMutation(entryId: number) {
  return useBlockTaskMutation([journalKeys.todos(entryId)])
}

/** Unblock a journal todo (server restores the previous status): optimistic, rolled back on failure. */
export function useUnblockTodoMutation(entryId: number) {
  return useUnblockTaskMutation([journalKeys.todos(entryId)])
}

/** Edit the reason of a blocked journal todo (PATCH { blockedReason } only). */
export function useEditBlockedReasonTodoMutation(entryId: number) {
  return useEditBlockedReasonMutation([journalKeys.todos(entryId)])
}

export function useEditTodoMutation(entryId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      patchApiV1TaskItemsById({
        path: { id },
        body: { title },
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
    mutationFn: ({ content, taskItemId }: { content: string; taskItemId?: number | null }) =>
      createLogEntry(entryId, content, taskItemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalKeys.all }),
  })
}

type JournalEntriesCache = { data?: JournalEntryResponseDto[] } | undefined
type LogCacheSnapshot = [QueryKey, JournalEntriesCache][]

function holdsEntry(cache: unknown, entryId: number): boolean {
  const list = (cache as JournalEntriesCache)?.data
  return Array.isArray(list) && list.some(e => e.id === entryId && Array.isArray(e.logEntries))
}

/** Patches one log entry inside the cached entries list (the `['journal']` query). */
function applyOptimisticLogUpdate(
  qc: QueryClient,
  entryId: number,
  logId: number,
  content: string,
  taskItemId: number | null,
): LogCacheSnapshot {
  const snapshot = qc
    .getQueriesData<JournalEntriesCache>({ queryKey: journalKeys.all })
    .filter(([, data]) => holdsEntry(data, entryId))
  const patch = (log: JournalLogEntryResponseDto): JournalLogEntryResponseDto => {
    const relinked = (log.taskItemId ?? null) !== taskItemId
    // A relink leaves the chip text to the refetch, except None, which has no chip at all.
    return {
      ...log,
      content,
      taskItemId,
      ...(relinked ? { linkedTaskDeleted: false, ...(taskItemId === null ? { linkedTaskTitle: null } : {}) } : {}),
    }
  }
  snapshot.forEach(([key]) => {
    qc.setQueryData<JournalEntriesCache>(key, old =>
      old?.data
        ? {
            ...old,
            data: old.data.map(e =>
              e.id === entryId ? { ...e, logEntries: e.logEntries.map(l => (l.id === logId ? patch(l) : l)) } : e,
            ),
          }
        : old,
    )
  })
  return snapshot
}

// Orders log updates so a failed one can tell whether a later one is still in flight.
let logUpdateSeq = 0

export function useUpdateLogEntryMutation(entryId: number) {
  const qc = useQueryClient()
  const mutationKey = journalKeys.logUpdate(entryId)
  return useMutation({
    mutationKey,
    mutationFn: ({ id, content, taskItemId }: { id: number; content: string; taskItemId?: number | null }) =>
      updateLogEntry(entryId, id, content, taskItemId),
    onMutate: async ({ id, content, taskItemId }) => {
      const seq = ++logUpdateSeq
      await qc.cancelQueries({ queryKey: journalKeys.all })
      return { seq, snapshot: applyOptimisticLogUpdate(qc, entryId, id, content, taskItemId ?? null) }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      // A later update still in flight has patched on top of this one: restoring this snapshot would clobber that
      // patch. Leave the cache to its settle invalidation instead.
      const laterPending = qc
        .getMutationCache()
        .findAll({ mutationKey, status: 'pending' })
        .some(m => ((m.state.context as { seq?: number } | undefined)?.seq ?? 0) > ctx.seq)
      if (!laterPending) ctx.snapshot.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    // While another update is in flight, skip the refetch: it would overwrite that update's optimistic patch.
    // This mutation is still counted as mutating inside onSettled, so 1 means it is the last one.
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) <= 1) return qc.invalidateQueries({ queryKey: journalKeys.all })
    },
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
  // Blocked counts as open (not done).
  return todos.filter(t => t.status !== 'Completed').length
}

/** Count blocked todos in a journal entry's todos list. */
export function blockedTodoCount(todos: TaskItemResponseDto[]): number {
  return todos.filter(t => t.status === 'Blocked').length
}

/** ISO date of yesterday relative to a given ISO date. */
export function yesterdayOf(isoDate: string): string {
  return addDays(isoDate, -1)
}
