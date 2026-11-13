import { useEffect, useLayoutEffect, useRef } from 'react'
import { CHORD_WINDOW_MS, isEditableTarget, isModalOpen } from '@/lib/keyboard-utils'

/** A handler returns false when it did nothing, so the browser's default for the key is left alone. */
type Handler = () => boolean | void

export interface JournalShortcutHandlers {
  onNewTodo: Handler
  onNewLog: Handler
  onNewNote: Handler
  onPrevDay: Handler
  onNextDay: Handler
  /** j: focus the next todo title. */
  onTodoNext: Handler
  /** k: focus the previous todo title. */
  onTodoPrev: Handler
  /** e: open the todo whose row has focus. */
  onTodoOpen: Handler
  /** c: toggle the todo whose row has focus. */
  onTodoToggle: Handler
}

/**
 * Keyboard shortcut handler for journal-specific actions.
 *
 * Single-key shortcuts fire only outside text fields and dialogs (Gmail convention). Space and Enter are never
 * bound here, so native button behaviour is kept. Navigation shortcuts (g→h, g→t, ?) are handled globally by
 * useGlobalKeyboardShortcuts; the key that follows `g` within the chord window belongs to that chord only.
 */
export function useJournalKeyboardShortcuts(handlers: JournalShortcutHandlers) {
  // Use a ref so the effect closure always sees the latest handlers
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    // Time of the last unmodified `g` that could have started a chord. Kept here, not shared with the global
    // hook, so the outcome does not depend on listener order.
    let lastGAt: number | null = null

    function handleKeyDown(e: KeyboardEvent) {
      // Never fire shortcuts from modifier combos (Ctrl/Alt/Meta)
      if (e.ctrlKey || e.altKey || e.metaKey) return

      // Any key ends a pending chord; this one is its second key if it came within the window.
      const afterG = lastGAt !== null && Date.now() - lastGAt <= CHORD_WINDOW_MS
      lastGAt = null

      // Single-key shortcuts only fire when no text field is active, and never behind a dialog or drawer
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return
      if (isModalOpen(e.target)) return

      if (afterG) return
      if (e.key === 'g') {
        lastGAt = Date.now()
        return
      }

      const h = handlersRef.current
      let acted: boolean | void
      switch (e.key) {
        case 't': acted = h.onNewTodo(); break
        case 'l': acted = h.onNewLog(); break
        case 'n': acted = h.onNewNote(); break
        case '[': acted = h.onPrevDay(); break
        case ']': acted = h.onNextDay(); break
        case 'j': acted = h.onTodoNext(); break
        case 'k': acted = h.onTodoPrev(); break
        case 'e':
          if (e.repeat) return
          acted = h.onTodoOpen()
          break
        case 'c':
          if (e.repeat) return
          acted = h.onTodoToggle()
          break
        default: return
      }
      if (acted !== false) e.preventDefault()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, []) // stable — handlers accessed via ref
}
