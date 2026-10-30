import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import {
  getApiV1TaskItems,
  patchApiV1TaskItemsById,
  getTaskV1,
  postApiV1TaskItems,
  putApiV1TaskItemsById,
  deleteApiV1TaskItemsById,
} from '@/api/client/sdk.gen'
import type { CreateTaskItemDto, TaskItemResponseDto, UpdateTaskItemDto } from '@/api/client/types.gen'
import { getTaskHistory } from '@/api/tasks'
import { projectKeys } from '@/hooks/projectKeys'
import { journalKeys } from '@/hooks/journalKeys'
import { filterPending, pendingKey, usePendingDeleteIds } from '@/hooks/useUndoableDelete'
import { getTimezoneOffsetMinutes } from '@/lib/journal-utils'
import {
  mapCachedTask,
  withBlocked,
  withBlockedReason,
  withUnblocked,
  type BlockableFields,
} from '@/lib/task-status'

export type TaskItemViewModel = TaskItemResponseDto & {
  currentJournalEntryId?: number | null
  currentJournalDate?: string | null
  firstTaggedDate?: string | null
  lastMovedDate?: string | null
  daysTagged?: number
  moveCount?: number
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
  /** PUT semantics: undefined/null keeps the stored reason, "" clears it. Only send while the status is Blocked. */
  blockedReason?: string | null
}

export const taskKeys = {
  all: ['tasks'] as const,
  detail: (id: number) => ['tasks', id] as const,
  history: (id: number) => ['tasks', id, 'history'] as const,
}

interface PendingTaskLike {
  id?: number | string | null
  parentTaskItemId?: number | string | null
  childTaskCount?: number | string
}

/** Pending task deletes grouped by their parent id (used to lower the parent's child count). */
function pendingChildCounts(list: readonly PendingTaskLike[], pendingKeys: ReadonlySet<string>) {
  const counts = new Map<number, number>()
  list.forEach(t => {
    if (t.id == null || t.parentTaskItemId == null) return
    if (!pendingKeys.has(pendingKey('task', t.id))) return
    const parentId = Number(t.parentTaskItemId)
    counts.set(parentId, (counts.get(parentId) ?? 0) + 1)
  })
  return counts
}

function withChildCount<T extends PendingTaskLike>(task: T, hidden: number): T {
  if (hidden <= 0) return task
  return { ...task, childTaskCount: Math.max(0, Number(task.childTaskCount ?? 0) - hidden) }
}

/**
 * Applied on read (never written to the cache): drops tasks whose delete is inside the undo window and lowers
 * each parent's `childTaskCount` by its pending children. Returns the input untouched when nothing is pending.
 */
export function hidePendingTasks<T extends PendingTaskLike>(list: readonly T[], pendingKeys: ReadonlySet<string>): T[] {
  if (pendingKeys.size === 0) return list as T[]
  const hiddenByParent = pendingChildCounts(list, pendingKeys)
  return filterPending('task', list, pendingKeys).map(t =>
    withChildCount(t, t.id == null ? 0 : (hiddenByParent.get(Number(t.id)) ?? 0)),
  )
}

export function useTasksQuery() {
  const { pendingKeys } = usePendingDeleteIds()
  const select = useCallback(
    (res: Awaited<ReturnType<typeof getApiV1TaskItems>>) => {
      const list = res.data as TaskItemViewModel[] | undefined
      if (!list || pendingKeys.size === 0) return res
      return { ...res, data: hidePendingTasks(list, pendingKeys) } as typeof res
    },
    [pendingKeys],
  )
  return useQuery({
    queryKey: taskKeys.all,
    queryFn: () => getApiV1TaskItems(),
    select,
  })
}

export function useTaskQuery(id: number) {
  const qc = useQueryClient()
  const { pendingKeys } = usePendingDeleteIds()
  const select = useCallback(
    (res: Awaited<ReturnType<typeof getTaskV1>>) => {
      if (pendingKeys.size === 0) return res
      // A pending id behaves as not found until Undo lifts the filter (the cached data is kept).
      if (pendingKeys.has(pendingKey('task', id))) return { ...res, data: undefined } as typeof res
      const task = res.data as TaskItemViewModel | undefined
      if (!task) return res
      const cachedList = qc.getQueryData<{ data?: TaskItemViewModel[] }>(taskKeys.all)?.data ?? []
      const hidden = pendingChildCounts(cachedList, pendingKeys).get(id) ?? 0
      return hidden > 0 ? ({ ...res, data: withChildCount(task, hidden) } as typeof res) : res
    },
    [pendingKeys, id, qc],
  )
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => getTaskV1({ path: { id } }),
    enabled: Number.isFinite(id),
    select,
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
          priority: data.priority,
          dueDate: data.dueDate,
          parentTaskItemId: data.parentTaskItemId ?? null,
          autoCompleteParentWhenChildrenDone: data.autoCompleteParentWhenChildrenDone ?? false,
          timezoneOffsetMinutes: getTimezoneOffsetMinutes(),
          // Omitted unless the caller sends it, so the stored reason is kept (merge-on-null).
          ...(data.blockedReason != null && { blockedReason: data.blockedReason }),
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

/**
 * Cache cleanup after a task delete committed (or turned out to be already gone). The detail entry is removed
 * FIRST so the refetch of ['tasks'] cannot revive it; the returned promise resolves once the refetches settle.
 * Pass `removeDetail: false` when the delete failed and the task still exists.
 */
export function invalidateAfterTaskDelete(qc: QueryClient, id: number, removeDetail = true): Promise<unknown> {
  if (removeDetail) qc.removeQueries({ queryKey: taskKeys.detail(id) })
  return Promise.all([
    qc.invalidateQueries({ queryKey: taskKeys.all }),
    qc.invalidateQueries({ queryKey: projectKeys.all }),
    qc.invalidateQueries({ queryKey: journalKeys.all }),
  ])
}

export function useDeleteTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    // The flag is passed per call (the client only rejects on HTTP errors when it is set).
    mutationFn: (id: number) => deleteApiV1TaskItemsById({ path: { id }, throwOnError: true }),
    onSuccess: (_result, id) => invalidateAfterTaskDelete(qc, id),
  })
}

// ─── Block / unblock ─────────────────────────────────────────────────────────

type Snapshot = Array<[QueryKey, unknown]>

/**
 * Optimistically transforms one task in the given cached queries. Returns the previous
 * cache values so the caller can roll back. Cancels in-flight fetches first so a stale
 * refetch cannot overwrite the optimistic write.
 */
export async function applyOptimisticTaskUpdate(
  qc: QueryClient,
  keys: readonly QueryKey[],
  id: number,
  fn: (task: BlockableFields) => BlockableFields,
): Promise<Snapshot> {
  await Promise.all(keys.map(queryKey => qc.cancelQueries({ queryKey })))
  const snapshot: Snapshot = keys.map(key => [key, qc.getQueryData(key)])
  keys.forEach(key => {
    if (qc.getQueryData(key) !== undefined) qc.setQueryData(key, (old: unknown) => mapCachedTask(old, id, fn))
  })
  return snapshot
}

export function rollbackTaskCache(qc: QueryClient, snapshot: Snapshot | undefined) {
  snapshot?.forEach(([key, data]) => qc.setQueryData(key, data))
}

/**
 * Shared by the tasks page and the journal. `extraKeys` are additional cached queries
 * holding the task (e.g. the journal todos of an entry).
 */
function useBlockedStatusMutation<TVars extends { id: number }>(
  extraKeys: readonly QueryKey[],
  buildBody: (vars: TVars) => Parameters<typeof patchApiV1TaskItemsById>[0]['body'],
  transform: (vars: TVars) => (task: BlockableFields) => BlockableFields,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: TVars) =>
      patchApiV1TaskItemsById({ path: { id: vars.id }, body: buildBody(vars), throwOnError: true }),
    onMutate: (vars) =>
      applyOptimisticTaskUpdate(qc, [taskKeys.all, taskKeys.detail(vars.id), ...extraKeys], vars.id, transform(vars)),
    onError: (_err, _vars, snapshot) => rollbackTaskCache(qc, snapshot),
    onSettled: (_result, _err, vars) => {
      qc.invalidateQueries({ queryKey: taskKeys.all })
      qc.invalidateQueries({ queryKey: taskKeys.detail(vars.id) })
      extraKeys.forEach(queryKey => qc.invalidateQueries({ queryKey }))
      qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

/** Block: PATCH { status: 'blocked', blockedReason? }. Always PATCH, never PUT. */
export function useBlockTaskMutation(extraKeys: readonly QueryKey[] = []) {
  return useBlockedStatusMutation<{ id: number; reason?: string }>(
    extraKeys,
    ({ reason }) => ({ status: 'blocked', ...(reason ? { blockedReason: reason } : {}) }),
    ({ reason }) => task => withBlocked(task, reason ? reason : null),
  )
}

/** Unblock: PATCH { status: 'todo' }; the server restores the previous status. */
export function useUnblockTaskMutation(extraKeys: readonly QueryKey[] = []) {
  return useBlockedStatusMutation<{ id: number }>(
    extraKeys,
    () => ({ status: 'todo' }),
    () => task => withUnblocked(task),
  )
}

/** Edit the reason of a Blocked task: PATCH { blockedReason } with no status. "" clears it. */
export function useEditBlockedReasonMutation(extraKeys: readonly QueryKey[] = []) {
  return useBlockedStatusMutation<{ id: number; reason: string }>(
    extraKeys,
    ({ reason }) => ({ blockedReason: reason }),
    ({ reason }) => task => withBlockedReason(task, reason ? reason : null),
  )
}
