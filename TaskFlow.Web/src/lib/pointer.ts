const TOUCH_QUERY = '(hover: none), (pointer: coarse)'

let cached: boolean | undefined

/**
 * True on touch-first devices. Evaluated once and memoised: it does not follow a mid-session
 * pointer change (hybrid devices). Call at click time, not at module load.
 */
export function isCoarsePointer(): boolean {
  if (cached === undefined) {
    cached = typeof window.matchMedia === 'function' && window.matchMedia(TOUCH_QUERY).matches
  }
  return cached
}

/** Test-only: forget the memoised result. */
export function __resetCoarsePointerCache(): void {
  cached = undefined
}
