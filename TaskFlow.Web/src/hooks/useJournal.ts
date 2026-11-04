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
  rollbackTaskCache,
} from '@/hooks/useTasks'
import { journalKeys } from '@/hooks/journalKeys'
import { filterPending, usePendingDeleteIds } from '@/hooks/useUndoableDelete'
import { isBlocked, mapCachedTask, withBlockedCompleted } from '@/lib/task-status'
import type { BlockableFields } from '@/lib/task-status'
import { addDays, formatEntryTitle, getTimezoneOffsetMinutes, todayISO } from '@/lib/journal-utils'
import { usePrefs } from '@/context/usePrefs'

// Re-exported so existing imports from '@/hooks/useJournal' keep working.
export { journalKeys }

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useJournalEntries() {
  return useQuery({
    queryKey: journalKeys.all,
    queryFn: () => getJournalEntries(getTimezoneOffsetMinutes()),
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
      const visible = filterPending('task', list, pendingKeys)
      return { ...res, data: visible } as typeof res
    },
    [pendingKeys],
  )
  return useQuery({
    queryKey: journalKeys.todos(entryId ?? 0),
    // The offset is not part of the key: invalidation relies on the ['journal', id, 'todos'] prefix.
    queryFn: () => getJournalTodos(entryId!, getTimezoneOffsetMinutes()),
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

type TodosCache = { data?: TaskItemResponseDto[] } | undefined
type CacheSnapshot = Array<[QueryKey, unknown]>

/** The cached journal entries list (the entries query lives under the `['journal']` prefix). */
function entriesCacheList(qc: QueryClient): JournalEntryResponseDto[] {
  const hits = qc.getQueriesData<JournalEntriesCache>({ queryKey: journalKeys.all })
  for (const [, cache] of hits) {
    const list = cache?.data
    if (Array.isArray(list) && list.length > 0 && 'todoTaskItemIds' in list[0]) return list
  }
  return []
}

/**
 * Moves a just-completed task between the cached day lists: a task completed from another day than today is
 * attributed to today (its completion day), so it leaves the viewed day and joins today's completed tier.
 * The list is flat (roots and subtasks alike), so a subtask moves like any other row.
 */
function moveCompletedAcrossDays(
  qc: QueryClient,
  viewedKey: QueryKey,
  todayKey: QueryKey | null,
  id: number,
  complete: (task: TaskItemResponseDto) => TaskItemResponseDto,
) {
  const viewed = qc.getQueryData<TodosCache>(viewedKey)
  const rows = viewed?.data
  if (!Array.isArray(rows)) return
  const row = rows.find(t => Number(t.id) === id)
  if (row) {
    qc.setQueryData<TodosCache>(viewedKey, old => (old?.data ? { ...old, data: old.data.filter(t => Number(t.id) !== id) } : old))
    // When today's list is not cached nothing is inserted: seeding a one-row list would be a wrong partial
    // list. The row is simply absent from the viewed day; today's list loads (and includes it) on first view,
    // and the settle invalidation of the ['journal'] prefix refreshes it if it was cached meanwhile.
    if (todayKey && qc.getQueryData<TodosCache>(todayKey)?.data) {
      qc.setQueryData<TodosCache>(todayKey, old => {
        if (!old?.data) return old
        const exists = old.data.some(t => Number(t.id) === id)
        return { ...old, data: exists ? old.data.map(t => (Number(t.id) === id ? complete(t) : t)) : [...old.data, complete(row)] }
      })
    }
  }
}

export function useToggleTodoMutation(entryId: number, isoDate?: string) {
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
    // Completing a row is optimistic (Blocked rows also clear their blocked fields, completedAt is set locally);
    // startedAt is never touched, so an InProgress task keeps it. Unticking waits for the server.
    // From a past day the row also leaves that day and joins today's completed tier (its completion day).
    onMutate: async ({ id, done }): Promise<CacheSnapshot | undefined> => {
      if (!done) return undefined
      const viewedKey = journalKeys.todos(entryId)
      const entries = entriesCacheList(qc)
      const viewedDay = isoDate ?? entries.find(e => e.id === entryId)?.date
      const today = todayISO()
      const todayEntryId = entries.find(e => e.date === today)?.id
      const leavesDay = viewedDay !== undefined && viewedDay !== today
      const todayKey = leavesDay && todayEntryId != null && todayEntryId !== entryId ? journalKeys.todos(todayEntryId) : null
      const keys: QueryKey[] = [viewedKey, ...(todayKey ? [todayKey] : []), taskKeys.all]
      await Promise.all(keys.map(queryKey => qc.cancelQueries({ queryKey })))
      const snapshot: CacheSnapshot = keys.map(key => [key, qc.getQueryData(key)])
      const completedAt = new Date().toISOString()
      const complete = <T extends BlockableFields>(task: T): T =>
        ({ ...(isBlocked(task.status) ? withBlockedCompleted(task) : { ...task, status: 'Completed' }), completedAt })
      if (leavesDay) {
        moveCompletedAcrossDays(qc, viewedKey, todayKey, id, complete)
      } else if (qc.getQueryData(viewedKey) !== undefined) {
        qc.setQueryData(viewedKey, (old: unknown) => mapCachedTask(old, id, complete))
      }
      if (qc.getQueryData(taskKeys.all) !== undefined) {
        qc.setQueryData(taskKeys.all, (old: unknown) => mapCachedTask(old, id, complete))
      }
      // Completing an open subtask also lowers its parent's cached openChildCount (when the parent row is in the
      // same list), so the parent does not keep hasOpenChildren (no Block button) until the refetch. Both lists
      // are in the snapshot, so onError restores them.
      const before = snapshot[0]?.[1] as TodosCache | undefined
      const completedRow = before?.data?.find(t => Number(t.id) === id)
      if (completedRow && completedRow.parentTaskItemId != null && completedRow.status !== 'Completed') {
        const parentId = Number(completedRow.parentTaskItemId)
        const dec = (old: TodosCache | undefined): TodosCache | undefined =>
          old?.data
            ? { ...old, data: old.data.map(t => (Number(t.id) === parentId ? { ...t, openChildCount: Math.max(0, Number(t.openChildCount ?? 0) - 1) } : t)) }
            : old
        qc.setQueryData<TodosCache>(viewedKey, dec)
        if (todayKey && qc.getQueryData<TodosCache>(todayKey)?.data) qc.setQueryData<TodosCache>(todayKey, dec)
      }
      return snapshot
    },
    onError: (_err, _vars, snapshot) => rollbackTaskCache(qc, snapshot),
    // The ['journal'] prefix covers the viewed day, today's list and the entries list.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: journalKeys.all })
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

/** Count open todos among the rendered work rows (context headers are never passed in). */
export function openTodoCount(todos: TaskItemResponseDto[]): number {
  // Blocked counts as open (not done).
  return todos.filter(t => t.status !== 'Completed').length
}

/** Count blocked todos among the rendered work rows. */
export function blockedTodoCount(todos: TaskItemResponseDto[]): number {
  return todos.filter(t => t.status === 'Blocked').length
}

/** ISO date of yesterday relative to a given ISO date. */
export function yesterdayOf(isoDate: string): string {
  return addDays(isoDate, -1)
}
