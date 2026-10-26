import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
    if (el.getAttribute('tabindex') === '-1' || el.closest('[hidden], [inert]')) return false
    const style = window.getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

interface FocusTrapOptions {
  /** Receives focus on deactivate when the opener is gone (e.g. the hamburger). */
  fallbackRef?: RefObject<HTMLElement | null>
}

/**
 * Traps Tab / Shift+Tab inside `ref` while `active`, and restores focus to whatever opened it on deactivate.
 * Declare this hook BEFORE any effect that moves focus into the container, so the opener is captured first.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  { fallbackRef }: FocusTrapOptions = {},
): void {
  useEffect(() => {
    if (!active) return
    const fallback = fallbackRef?.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
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
      if (e.shiftKey) {
        if (current === first || current === container || !container.contains(current)) {
          e.preventDefault()
          last.focus()
        }
      } else if (current === last || !container.contains(current)) {
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
