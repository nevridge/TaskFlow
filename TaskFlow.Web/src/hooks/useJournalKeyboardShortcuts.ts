import { useEffect, useLayoutEffect, useRef } from 'react'

export interface JournalShortcutHandlers {
  onNewTodo: () => void
  onNewLog: () => void
  onFocusNotes: () => void
  onPrevDay: () => void
  onNextDay: () => void
  onGoHome: () => void
  onGoTasks: () => void
  onShowHelp: () => void
}

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

/**
 * Global keyboard shortcut handler for the journal page.
 *
 * Single-key shortcuts fire only when no text input is focused (Gmail convention).
 * Two-key chords (g → h, g → t) use a 1.5s window after pressing g.
 */
export function useJournalKeyboardShortcuts(handlers: JournalShortcutHandlers) {
  // Use a ref so the effect closure always sees the latest handlers
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  })

  // Track pending chord: null = no chord, 'g' = waiting for second key
  const pendingChordRef = useRef<string | null>(null)
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function clearChord() {
      pendingChordRef.current = null
      if (chordTimerRef.current !== null) {
        clearTimeout(chordTimerRef.current)
        chordTimerRef.current = null
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Never fire shortcuts from modifier combos (Ctrl/Alt/Meta)
      if (e.ctrlKey || e.altKey || e.metaKey) return

      // If a chord is pending, handle the second key regardless of input focus
      if (pendingChordRef.current === 'g') {
        clearChord()
        if (e.key === 'h') {
          e.preventDefault()
          handlersRef.current.onGoHome()
        } else if (e.key === 't') {
          e.preventDefault()
          handlersRef.current.onGoTasks()
        }
        // Any other key silently cancels the chord
        return
      }

      // Single-key shortcuts only fire when no text field is active
      if (isInputFocused()) return

      switch (e.key) {
        case '?':
          e.preventDefault()
          handlersRef.current.onShowHelp()
          break
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
          handlersRef.current.onFocusNotes()
          break
        case '[':
          e.preventDefault()
          handlersRef.current.onPrevDay()
          break
        case ']':
          e.preventDefault()
          handlersRef.current.onNextDay()
          break
        case 'g':
          // Start chord; wait up to 1.5s for the second key
          e.preventDefault()
          pendingChordRef.current = 'g'
          chordTimerRef.current = setTimeout(clearChord, 1500)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (chordTimerRef.current !== null) clearTimeout(chordTimerRef.current)
    }
  }, []) // stable — handlers accessed via ref
}
