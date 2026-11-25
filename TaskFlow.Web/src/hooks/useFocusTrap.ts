import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isRadio(el: HTMLElement): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'radio'
}

function getFocusables(container: HTMLElement): HTMLElement[] {
  const visible = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
    if (el.getAttribute('tabindex') === '-1' || el.closest('[hidden], [inert]')) return false
    const style = window.getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
  // Browsers give a radio group with a checked member one tab stop (the checked radio).
  const checked = visible.filter(isRadio).filter(r => r.checked && r.name)
  return visible.filter(
    el => !isRadio(el) || el.checked || !checked.some(c => c.name === el.name && c.form === el.form),
  )
}

function isBefore(a: Node, b: Node): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

interface FocusTrapOptions {
  /** Receives focus on deactivate when the opener is gone (e.g. the hamburger). */
  fallbackRef?: RefObject<HTMLElement | null>
  /** Stops trapping Tab (a nested dialog owns it) without deactivating, so focus is not restored. */
  paused?: boolean
}

/**
 * Traps Tab / Shift+Tab inside `ref` while `active`, and restores focus to whatever opened it on deactivate.
 * Declare this hook BEFORE any effect that moves focus into the container, so the opener is captured first.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  { fallbackRef, paused = false }: FocusTrapOptions = {},
): void {
  // Read through a ref: re-running the trap effect would restore focus to the opener.
  const pausedRef = useRef(paused)
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    if (!active) return
    const fallback = fallbackRef?.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || pausedRef.current) return
      const container = ref.current
      if (!container) return
      const focusables = getFocusables(container)
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const current = document.activeElement
      // `current` can be inside the container but not in the list (an unchecked radio), hence the
      // position checks: nothing listed before it (or after it) means the browser would leave.
      const outside = !current || !container.contains(current)
      if (e.shiftKey) {
        if (outside || current === first || current === container || isBefore(current, first)) {
          e.preventDefault()
          last.focus()
        }
      } else if (outside || current === last || (current !== container && isBefore(last, current))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handler)

    return () => {
      document.removeEventListener('keydown', handler)
      if (opener && opener.isConnected && opener !== document.body) {
        opener.focus()
      } else {
        fallback?.focus()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; only `active` should re-run this
  }, [active])
}
