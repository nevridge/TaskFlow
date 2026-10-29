import { createContext } from 'react'

/** What a caller hands to `schedule`. The provider adds the timer bookkeeping. */
export interface PendingDeleteInput {
  /** Dedupe key, e.g. "todo:12:5". A delete whose id is already pending is ignored. */
  id: string
  /** Every key hidden by this delete (the parent plus its children). */
  keys: string[]
  message: string
  errorMessage: string
  /** Calls the API directly with captured ids (not a mutation: those do not report after unmount). */
  commit: () => Promise<unknown>
  /** Runs after the commit settles, success or failure (query invalidation). */
  onSettled?: () => void | Promise<unknown>
  /** Restores focus to the restored row after Undo. Skipped when focus has already moved somewhere valid. */
  onRestore?: () => void
}

export interface ToastContextValue {
  schedule: (pd: PendingDeleteInput) => void
  undo: (id: string) => void
  undoLatest: () => void
  isPending: (key: string) => boolean
  pendingKeys: ReadonlySet<string>
}

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>()

/** Without a provider, deletes run immediately and nothing is ever hidden. */
export const defaultToastContext: ToastContextValue = {
  schedule: pd => {
    void Promise.resolve()
      .then(() => pd.commit())
      .catch(() => undefined)
      .then(() => pd.onSettled?.())
      .catch(() => undefined)
  },
  undo: () => undefined,
  undoLatest: () => undefined,
  isPending: () => false,
  pendingKeys: EMPTY_KEYS,
}

export const ToastContext = createContext<ToastContextValue>(defaultToastContext)
