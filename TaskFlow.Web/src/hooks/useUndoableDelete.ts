import { useCallback } from 'react'
import { useToast } from '@/context/useToast'

export interface RequestDeleteOptions {
  /** Pending key, e.g. "todo:12:5", "note:7", "log:3". Also the dedupe id. */
  key: string
  /** Extra keys hidden together with `key` (a parent's children). */
  hideKeys?: string[]
  message: string
  errorMessage: string
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
        commit: opts.commit,
        onSettled: opts.invalidate,
        onRestore: opts.restoreFocus,
      })
    },
    [schedule],
  )

  return { requestDelete, isHidden: isPending }
}
