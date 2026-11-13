import { useSyncExternalStore } from 'react'

/** The journal stacks its columns at this width and narrower. journal.css uses the same query (a test keeps them equal). */
export const STACKED_QUERY = '(max-width: 820px)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(STACKED_QUERY)
  mql.addEventListener?.('change', onChange)
  return () => mql.removeEventListener?.('change', onChange)
}

function getSnapshot() {
  return typeof window.matchMedia === 'function' && window.matchMedia(STACKED_QUERY).matches
}

/** True while the journal is in its single-column layout. Without matchMedia it reports false (not stacked). */
export function useStackedLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
