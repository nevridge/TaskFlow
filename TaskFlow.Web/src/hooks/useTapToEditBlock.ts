import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { isCoarsePointer } from '@/lib/pointer'

interface TapToEditBlockProps {
  role: 'button'
  tabIndex: 0
  className: 'edit-trigger'
  onClick: (e: MouseEvent<HTMLElement>) => void
  onDoubleClick: () => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

/**
 * Same edit rule as `useTapToEdit` for content that cannot live inside a `<button>` (paragraphs and lists):
 * a single tap on touch (decided per event), a double-click with a mouse, and Enter/Space from the keyboard.
 * `onEdit` must be idempotent: a double-tap fires click and dblclick. The returned handlers are stable and
 * always call the latest `onEdit`.
 */
export function useTapToEditBlock(onEdit: () => void): TapToEditBlockProps {
  const onEditRef = useRef(onEdit)
  useEffect(() => {
    onEditRef.current = onEdit
  })

  return useMemo<TapToEditBlockProps>(
    () => ({
      role: 'button',
      tabIndex: 0,
      className: 'edit-trigger',
      onClick: e => {
        if (e.detail === 0 || isCoarsePointer()) onEditRef.current()
      },
      onDoubleClick: () => onEditRef.current(),
      onKeyDown: e => {
        // Keys from a nested interactive child belong to that child.
        if (e.target !== e.currentTarget) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        if (e.nativeEvent.isComposing) return
        e.preventDefault()
        if (e.repeat) return
        onEditRef.current()
      },
    }),
    [],
  )
}
