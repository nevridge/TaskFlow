import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { isCoarsePointer } from '@/lib/pointer'

interface TapToEditOptions {
  /** Edit on any single click, regardless of pointer type. */
  singleClickAlways?: boolean
}

interface TapToEditProps {
  className: 'edit-trigger'
  onClick: (e: MouseEvent<HTMLElement>) => void
  onDoubleClick: () => void
}

/**
 * Props for a `<button type="button">` that enters edit mode: a single tap on touch, a double-click with a
 * mouse, and Enter/Space from the keyboard (a native button turns those into a click with detail 0).
 * The touch decision is made at event time. `onEdit` must be idempotent: a double-tap fires click and dblclick.
 * The returned handlers are stable and always call the latest `onEdit`.
 */
export function useTapToEdit(onEdit: () => void, options?: TapToEditOptions): TapToEditProps {
  const onEditRef = useRef(onEdit)
  useEffect(() => {
    onEditRef.current = onEdit
  })
  const singleClickAlways = options?.singleClickAlways ?? false

  return useMemo<TapToEditProps>(
    () => ({
      className: 'edit-trigger',
      onClick: e => {
        if (singleClickAlways || e.detail === 0 || isCoarsePointer()) onEditRef.current()
      },
      onDoubleClick: () => onEditRef.current(),
    }),
    [singleClickAlways],
  )
}
