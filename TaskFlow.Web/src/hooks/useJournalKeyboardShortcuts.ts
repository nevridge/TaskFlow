import { useEffect, useLayoutEffect, useRef } from 'react'
import { isInputFocused } from '@/lib/keyboard-utils'

export interface JournalShortcutHandlers {
  onNewTodo: () => void
  onNewLog: () => void
  onNewNote: () => void
  onPrevDay: () => void
  onNextDay: () => void
  onJumpToToday: () => void
}

/**
 * Keyboard shortcut handler for journal-specific actions.
 *
 * Single-key shortcuts fire only when no text input is focused (Gmail convention).
 * Navigation shortcuts (g→h, g→t, ?) are handled globally by useGlobalKeyboardShortcuts.
 */
export function useJournalKeyboardShortcuts(handlers: JournalShortcutHandlers) {
  // Use a ref so the effect closure always sees the latest handlers
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Never fire shortcuts from modifier combos (Ctrl/Alt/Meta)
      if (e.ctrlKey || e.altKey || e.metaKey) return

      // Single-key shortcuts only fire when no text field is active
      if (isInputFocused()) return

      switch (e.key) {
        case 't':
          e.preventDefault()
          handlersRef.current.onNewTodo()
          break
        case 'l':
          e.preventDefault()
          handlersRef.current.onNewLog()
          break
        case 'n':
          e.preventDefault()
          handlersRef.current.onNewNote()
          break
        case '[':
          e.preventDefault()
          handlersRef.current.onPrevDay()
          break
        case ']':
          e.preventDefault()
          handlersRef.current.onNextDay()
          break
        case 'j':
          e.preventDefault()
          handlersRef.current.onJumpToToday()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, []) // stable — handlers accessed via ref
}
