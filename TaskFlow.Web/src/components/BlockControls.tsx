import { useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'

export const BLOCK_REASON_MAX_LENGTH = 200

/** Ban glyph used for the Block action, the blocked checkbox and the Blocked badge. */
export function BlockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    </svg>
  )
}

interface BlockReasonInputProps {
  className: string
  initialValue?: string
  onSubmit: (reason: string) => void
  onCancel: (reason: string, via: 'escape' | 'blur') => void
}

/**
 * Inline reason entry. Enter saves (an empty reason is valid), Esc cancels, and blur
 * (Tab away or click elsewhere) cancels without saving.
 */
export function BlockReasonInput({ className, initialValue = '', onSubmit, onCancel }: BlockReasonInputProps) {
  const [value, setValue] = useState(initialValue)
  // Set once Enter or Esc has been handled so the blur caused by unmounting is ignored.
  const closedRef = useRef(false)

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Keep typed characters (e.g. "g") away from the global keyboard shortcuts.
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      if (closedRef.current) return
      closedRef.current = true
      onSubmit(value.trim())
    } else if (e.key === 'Escape') {
      closedRef.current = true
      onCancel(value, 'escape')
    }
  }

  return (
    <input
      className={className}
      type="text"
      aria-label="Blocked reason, optional"
      placeholder="Why is it blocked? (optional)"
      maxLength={BLOCK_REASON_MAX_LENGTH}
      value={value}
      autoFocus
      onChange={e => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (closedRef.current) return
        closedRef.current = true
        onCancel(value, 'blur')
      }}
    />
  )
}

type BlockedReasonTextProps = Omit<ComponentProps<'button'>, 'onClick' | 'title' | 'children' | 'type'> & {
  reason: string
  onEdit: () => void
}

/**
 * Single-line muted reason (ellipsis, full text in the title). A real button so the keyboard can reach it.
 * An empty reason renders an "Add reason" prompt so a reason can still be added later.
 */
export function BlockedReasonText({ reason, onEdit, ...rest }: BlockedReasonTextProps) {
  const empty = reason === ''
  return (
    <button
      {...rest}
      type="button"
      title={empty ? undefined : reason}
      aria-label={empty ? 'Add blocked reason' : `Blocked reason: ${reason}. Edit`}
      onClick={e => {
        // Enter/Space fire click with detail 0; a mouse needs a double-click.
        if (e.detail === 0) onEdit()
      }}
      onDoubleClick={onEdit}
    >
      {empty ? 'Add reason' : reason}
    </button>
  )
}
