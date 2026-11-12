/** How long after `g` the next key still belongs to the g-chord (g h, g t). */
export const CHORD_WINDOW_MS = 1500

export function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    !!(el as HTMLElement).isContentEditable
  )
}

export function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** True while a modal dialog or the open settings drawer is on screen. */
export function isModalOpen(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest('[role="dialog"]')) return true
  return !!document.querySelector('[role="dialog"][aria-modal="true"], .settings-drawer.is-open')
}
