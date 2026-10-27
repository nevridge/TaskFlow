import { isCoarsePointer } from '@/lib/pointer'
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
 * Inline reason entry. Enter saves (an empty reason is valid) and Esc cancels on every device.
 * Desktop: blur (Tab away or click elsewhere) cancels without saving, unless focus moved to something
 * inside the editor. Touch: blur never cancels (dismissing the soft keyboard must not lose the draft), so
 * explicit Cancel and Save buttons are shown instead.
 */
export function BlockReasonInput({ className, initialValue = '', onSubmit, onCancel }: BlockReasonInputProps) {
  const [value, setValue] = useState(initialValue)
  // Set once Enter, Esc, Save or Cancel has been handled so a later blur (e.g. from unmounting) is ignored.
  const closedRef = useRef(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  // Decided when the editor renders; blur re-checks at event time.
  const [touch] = useState(() => isCoarsePointer())

  function submit() {
    if (closedRef.current) return
    closedRef.current = true
    onSubmit(value.trim())
  }

  function cancel(via: 'escape' | 'blur') {
    closedRef.current = true
    onCancel(value, via)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Keep typed characters (e.g. "g") away from the global keyboard shortcuts.
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      cancel('escape')
    }
  }

  return (
    <span className="block-editor" ref={wrapperRef}>
      <input
        className={className}
        type="text"
        aria-label="Blocked reason, optional"
        placeholder="Why is it blocked? (optional)"
        maxLength={BLOCK_REASON_MAX_LENGTH}
        value={value}
        autoFocus
        enterKeyHint="done"
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={e => {
          if (closedRef.current || touch || isCoarsePointer()) return
          const next = e.relatedTarget
          if (next instanceof Node && wrapperRef.current?.contains(next)) return
          cancel('blur')
        }}
      />
      {touch && (
        <span className="block-editor-actions">
          <button type="button" className="block-editor-cancel" onClick={() => { if (!closedRef.current) cancel('escape') }}>
            Cancel
          </button>
          <button type="button" className="block-editor-save" onClick={submit}>
            Save
          </button>
        </span>
      )}
    </span>
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
      className={`${rest.className ?? ''} edit-trigger`.trim()}
      type="button"
      title={empty ? undefined : reason}
      aria-label={empty ? 'Add blocked reason' : `Blocked reason: ${reason}. Edit`}
      onClick={e => {
        // Enter/Space fire click with detail 0; touch edits on a single tap; a mouse needs a double-click,
        // except on the "Add reason" prompt. onEdit must stay idempotent: a double-tap fires it twice.
        if (empty || e.detail === 0 || isCoarsePointer()) onEdit()
      }}
      onDoubleClick={onEdit}
    >
      {empty ? 'Add reason' : reason}
    </button>
  )
}
