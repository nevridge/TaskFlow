import { useCallback, useMemo } from 'react'
import { useToast } from '@/context/useToast'

export interface RequestDeleteOptions {
  /** Pending key, e.g. "todo:12:5", "note:7", "log:3", "task:9", "tasknote:4". Also the dedupe id. */
  key: string
  /** Extra keys hidden together with `key` (a parent's children). */
  hideKeys?: string[]
  message: string
  /** A function receives the error the commit threw. */
  errorMessage: string | ((err: unknown) => string)
  /** Undo window in ms. Defaults to the provider's 6s. */
  durationMs?: number
  commit: () => Promise<unknown>
  invalidate: () => void | Promise<unknown>
  restoreFocus?: () => void
}

/** Deferred, undoable delete: the item is hidden at once and `commit` runs after the undo window. */
export function useUndoableDelete() {
  const { schedule, isPending } = useToast()

  const requestDelete = useCallback(
    (opts: RequestDeleteOptions) => {
      schedule({
        id: opts.key,
        keys: [opts.key, ...(opts.hideKeys ?? [])],
        message: opts.message,
        errorMessage: opts.errorMessage,
        durationMs: opts.durationMs,
        commit: opts.commit,
        onSettled: opts.invalidate,
        onRestore: opts.restoreFocus,
      })
    },
    [schedule],
  )

  return { requestDelete, isHidden: isPending }
}

// ─── Tasks-page pending keys ─────────────────────────────────────────────────
// Namespaced so a task note 5 is never confused with journal note 5 ("note:5") or a journal todo.

export type TaskPendingKind = 'task' | 'tasknote'

export function pendingKey(kind: TaskPendingKind, id: number | string): string {
  return `${kind}:${id}`
}

type WithId = { id?: number | string | null }

/** Pure: drops the items whose namespaced key is pending. */
export function filterPending<T extends WithId>(
  kind: TaskPendingKind,
  items: readonly T[],
  pendingKeys: ReadonlySet<string>,
): T[] {
  if (pendingKeys.size === 0) return items as T[]
  return items.filter(item => item.id == null || !pendingKeys.has(pendingKey(kind, item.id)))
}

/** Stable per pending set, so it is safe as a `select` dependency. */
export function usePendingDeleteIds() {
  const { pendingKeys } = useToast()
  const isPending = useCallback(
    (kind: TaskPendingKind, id: number | string) => pendingKeys.has(pendingKey(kind, id)),
    [pendingKeys],
  )
  return useMemo(() => ({ isPending, pendingKeys }), [isPending, pendingKeys])
}

export function useFilterPending<T extends WithId>(kind: TaskPendingKind, items: readonly T[]): T[] {
  const { pendingKeys } = usePendingDeleteIds()
  return useMemo(() => filterPending(kind, items, pendingKeys), [kind, items, pendingKeys])
}
