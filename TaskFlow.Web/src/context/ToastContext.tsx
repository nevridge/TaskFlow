import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToastContext } from './ToastContextDef'
import type { PendingDeleteInput, ToastContextValue } from './ToastContextDef'

const UNDO_WINDOW_MS = 6000
const MIN_RESUME_MS = 2000
const MAX_VISIBLE_PENDING = 3
const MAX_ERRORS = 3

type PauseReason = 'hover' | 'focus' | 'press'

interface Entry extends PendingDeleteInput {
  phase: 'pending' | 'committing'
  remainingMs: number
  startedAt: number
  timerId: number | undefined
  paused: Set<PauseReason>
  /** True once the toast was kept out of view, so it appears later without the enter animation. */
  wasHidden: boolean
}

interface ErrorToast {
  id: number
  message: string
}

/** What render needs, copied out of the ref-held queue whenever it changes. */
interface Snapshot {
  keys: ReadonlySet<string>
  visible: { id: string; message: string; wasHidden: boolean }[]
  errors: ErrorToast[]
}

const EMPTY_SNAPSHOT: Snapshot = { keys: new Set(), visible: [], errors: [] }

function clearTimer(entry: Entry) {
  if (entry.timerId !== undefined) {
    window.clearTimeout(entry.timerId)
    entry.timerId = undefined
  }
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** True while a modal dialog or the open settings drawer is on screen. */
function isModalOpen(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest('[role="dialog"]')) return true
  return !!document.querySelector('[role="dialog"][aria-modal="true"], .settings-drawer.is-open')
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const entriesRef = useRef(new Map<string, Entry>())
  const errorsRef = useRef<ErrorToast[]>([])
  const errorSeq = useRef(0)
  const mountedRef = useRef(true)
  const regionRef = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT)

  // Publishes the ref-held queue to render. Always called from handlers, timers or effects.
  const bump = useCallback(() => {
    if (!mountedRef.current) return
    const keys = new Set<string>()
    const pending: Entry[] = []
    entriesRef.current.forEach(e => {
      e.keys.forEach(k => keys.add(k))
      if (e.phase === 'pending') pending.push(e)
    })
    setSnapshot({
      keys,
      visible: pending
        .slice(-MAX_VISIBLE_PENDING)
        .map(e => ({ id: e.id, message: e.message, wasHidden: e.wasHidden })),
      errors: errorsRef.current,
    })
  }, [])

  const commitEntry = useCallback(
    (entry: Entry) => {
      if (entry.phase !== 'pending' || entriesRef.current.get(entry.id) !== entry) return
      clearTimer(entry)
      entry.phase = 'committing'
      bump()
      void (async () => {
        let ok = true
        try {
          await entry.commit()
        } catch {
          ok = false
        }
        if (!ok) {
          // Restore the item at once; the invalidation below then re-syncs with the server.
          entriesRef.current.delete(entry.id)
          const next = [...errorsRef.current, { id: ++errorSeq.current, message: entry.errorMessage }]
          errorsRef.current = next.slice(-MAX_ERRORS)
          bump()
        }
        try {
          await entry.onSettled?.()
        } catch {
          // An invalidation failure must not keep the item hidden.
        }
        // On success the key stays hidden until the refetch resolved, so the row does not flicker back.
        if (entriesRef.current.get(entry.id) === entry) {
          entriesRef.current.delete(entry.id)
          bump()
        }
      })()
    },
    [bump],
  )

  const startTimer = useCallback(
    (entry: Entry, ms: number) => {
      clearTimer(entry)
      entry.remainingMs = ms
      entry.startedAt = Date.now()
      entry.timerId = window.setTimeout(() => commitEntry(entry), ms)
    },
    [commitEntry],
  )

  const schedule = useCallback(
    (pd: PendingDeleteInput) => {
      if (entriesRef.current.has(pd.id)) return
      const entry: Entry = {
        ...pd,
        phase: 'pending',
        remainingMs: UNDO_WINDOW_MS,
        startedAt: Date.now(),
        timerId: undefined,
        paused: new Set(),
        wasHidden: false,
      }
      entriesRef.current.set(pd.id, entry)
      startTimer(entry, UNDO_WINDOW_MS)
      // Toasts pushed out of the newest three keep running but stay hidden.
      const pending = [...entriesRef.current.values()].filter(e => e.phase === 'pending')
      pending.slice(0, Math.max(0, pending.length - MAX_VISIBLE_PENDING)).forEach(e => {
        e.wasHidden = true
      })
      bump()
    },
    [bump, startTimer],
  )

  /**
   * `fromToast`: the Undo button unmounts with its toast, so its focus is lost and the row always gets
   * focus back. From the keyboard, focus is restored only if nothing holds it (body); otherwise the
   * user's current, valid focus is left alone.
   */
  const undoEntry = useCallback(
    (id: string, fromToast: boolean) => {
      const entry = entriesRef.current.get(id)
      if (!entry || entry.phase !== 'pending') return
      clearTimer(entry)
      entriesRef.current.delete(id)
      bump()
      const onRestore = entry.onRestore
      if (onRestore) {
        // After the re-render, so the restored row exists. A row that is gone (other date) is a no-op.
        window.requestAnimationFrame(() => {
          const active = document.activeElement
          if (fromToast || !active || active === document.body) onRestore()
        })
      }
    },
    [bump],
  )

  const undo = useCallback((id: string) => undoEntry(id, true), [undoEntry])

  const undoLatest = useCallback(() => {
    const pending = [...entriesRef.current.values()].filter(e => e.phase === 'pending')
    const latest = pending[pending.length - 1]
    if (latest) undoEntry(latest.id, false)
  }, [undoEntry])

  const pause = useCallback((id: string, reason: PauseReason) => {
    const entry = entriesRef.current.get(id)
    if (!entry || entry.phase !== 'pending') return
    const wasRunning = entry.paused.size === 0
    entry.paused.add(reason)
    if (wasRunning) {
      clearTimer(entry)
      entry.remainingMs = Math.max(0, entry.remainingMs - (Date.now() - entry.startedAt))
    }
  }, [])

  const resume = useCallback(
    (id: string, reason: PauseReason) => {
      const entry = entriesRef.current.get(id)
      if (!entry || entry.phase !== 'pending' || !entry.paused.delete(reason)) return
      if (entry.paused.size === 0) startTimer(entry, Math.max(entry.remainingMs, MIN_RESUME_MS))
    },
    [startTimer],
  )

  const dismissError = useCallback(
    (id: number) => {
      errorsRef.current = errorsRef.current.filter(e => e.id !== id)
      bump()
    },
    [bump],
  )

  // Provider unmount: drop every timer and never commit. State lives in refs, so this is idempotent and
  // safe under StrictMode's simulated unmount (nothing is scheduled yet at that point).
  useEffect(() => {
    mountedRef.current = true
    const entries = entriesRef.current
    return () => {
      mountedRef.current = false
      entries.forEach(clearTimer)
    }
  }, [])

  // Undo shortcuts: Ctrl/Cmd+Z and plain "u".
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isUndoKey =
        e.key.toLowerCase() === 'z'
          ? (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
          : e.key === 'u' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      if (!isUndoKey) return
      if (![...entriesRef.current.values()].some(en => en.phase === 'pending')) return
      if (e.defaultPrevented || e.isComposing || e.repeat) return
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return
      if (isModalOpen(e.target)) return
      e.preventDefault()
      undoLatest()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [undoLatest])

  // Keep the region above the on-screen keyboard where the visual viewport reports it (absent in jsdom).
  useEffect(() => {
    const vv = window.visualViewport
    const region = regionRef.current
    if (!vv || !region) return
    const update = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      region.style.setProperty('--toast-kb-offset', `${offset}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      schedule,
      undo,
      undoLatest,
      pendingKeys: snapshot.keys,
      isPending: (key: string) => snapshot.keys.has(key),
    }),
    [snapshot.keys, schedule, undo, undoLatest],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Always mounted so assistive tech knows the region before the first toast; each toast carries its own live role. */}
      <div ref={regionRef} className="toast-region" role="region" aria-label="Notifications">
        {snapshot.visible.map(entry => (
          <div
            key={entry.id}
            className={'toast' + (entry.wasHidden ? '' : ' toast-enter')}
            role="status"
            onPointerEnter={() => pause(entry.id, 'hover')}
            onPointerLeave={() => resume(entry.id, 'hover')}
            onPointerDown={() => pause(entry.id, 'press')}
            onPointerUp={() => resume(entry.id, 'press')}
            onPointerCancel={() => resume(entry.id, 'press')}
            onFocus={() => pause(entry.id, 'focus')}
            onBlur={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(entry.id, 'focus')
            }}
          >
            <span className="toast-msg">{entry.message}</span>
            <button type="button" className="toast-btn tap-target" onClick={() => undo(entry.id)}>
              Undo
            </button>
          </div>
        ))}
        {snapshot.errors.map(err => (
          <div
            key={err.id}
            className="toast toast-error toast-enter"
            role="alert"
            tabIndex={-1}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                dismissError(err.id)
              }
            }}
          >
            <span className="toast-msg">{err.message}</span>
            <button
              type="button"
              className="toast-btn tap-target"
              aria-label="Dismiss error"
              onClick={() => dismissError(err.id)}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
