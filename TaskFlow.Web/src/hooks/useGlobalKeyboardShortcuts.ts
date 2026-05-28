import { useEffect, useLayoutEffect, useRef } from 'react'
import { isInputFocused } from '@/lib/keyboard-utils'

export interface GlobalShortcutHandlers {
  onGoHome: () => void
  onGoTasks: () => void
  onShowHelp: () => void
}

/**
 * Global keyboard shortcut handler for navigation shortcuts available on every page.
 *
 * Single-key shortcuts fire only when no text input is focused (Gmail convention).
 * Two-key chords (g → h, g → t) use a 1.5s window after pressing g.
 */
export function useGlobalKeyboardShortcuts(
  handlers: GlobalShortcutHandlers,
  options?: { disabled?: boolean },
): void {
  // Use a ref so the effect closure always sees the latest handlers
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  })

  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    optionsRef.current = options
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
      if (optionsRef.current?.disabled) return

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
  }, []) // stable — handlers and options accessed via refs
}
