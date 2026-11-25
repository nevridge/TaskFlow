import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { AreaResponseDto } from '@/api/areas'
import { useAreasQuery, useCreateAreaMutation } from '@/hooks/useAreas'
import { getApiErrorMessage } from '@/lib/api-error'
import { validateAreaName } from '@/lib/area-validation'

const NEW_AREA = '__new'
const BLOCKED_MESSAGE = 'Add or cancel the new area first.'

export interface ProjectAreaSelectHandle {
  /** True when a typed, un-added name is in the open field: shows why, focuses it and the save must not go ahead. */
  blockSave(): boolean
  /** The area to submit: null when the selected one no longer exists. */
  resolveValue(): number | null
  /** Closes an open field that holds no name. */
  closeEmptyField(): void
}

interface ProjectAreaSelectProps {
  ref?: Ref<ProjectAreaSelectHandle>
  value: number | null
  onChange: (areaId: number | null) => void
  /** Name of the project's saved area, shown while the area list is unavailable. */
  currentAreaId?: number | null
  currentAreaName?: string | null
}

export function ProjectAreaSelect({
  ref,
  value,
  onChange,
  currentAreaId,
  currentAreaName,
}: ProjectAreaSelectProps) {
  const uid = useId()
  const selectId = `${uid}-area`
  const errorId = `${uid}-area-error`
  const query = useAreasQuery()
  const createMutation = useCreateAreaMutation()
  const areas = query.data?.data

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  /** Bumped when the field should take focus. */
  const [focusRequest, setFocusRequest] = useState(0)
  const selectRef = useRef<HTMLSelectElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef(false)
  /** Changes on every close, so a late Add result is ignored. */
  const sessionRef = useRef(0)
  // On Windows every arrow step on a closed select fires `change`; stepping must not pull focus away.
  const steppingRef = useRef(false)

  // Once areas have loaded, a deleted area counts as "No area". Until then keep the id, so a save cannot clear it.
  const effective = value !== null && areas && !areas.some(a => a.id === value) ? null : value

  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus()
  }, [focusRequest])

  function close() {
    sessionRef.current += 1
    pendingRef.current = false
    setOpen(false)
    setDraft('')
    setError(null)
    setPending(false)
  }

  function cancel() {
    close()
    selectRef.current?.focus()
  }

  useImperativeHandle(ref, () => ({
    blockSave() {
      if (!open || !draft.trim()) return false
      setError(BLOCKED_MESSAGE)
      inputRef.current?.focus()
      return true
    },
    resolveValue: () => effective,
    closeEmptyField() {
      if (!draft.trim()) close()
    },
  }))

  async function add() {
    if (pendingRef.current) return
    // Before Add is disabled: a focused button that becomes disabled drops focus to body.
    inputRef.current?.focus()
    const invalid = validateAreaName(draft)
    setError(invalid)
    if (invalid) return
    const session = sessionRef.current
    pendingRef.current = true
    setPending(true)
    try {
      const result = await createMutation.mutateAsync(draft.trim())
      if (session !== sessionRef.current) return
      onChange((result.data as AreaResponseDto).id)
      cancel()
    } catch (err) {
      if (session !== sessionRef.current) return
      pendingRef.current = false
      setPending(false)
      setError(getApiErrorMessage(err, 'Could not add area.'))
      inputRef.current?.focus()
    }
  }

  function handleSelect(next: string) {
    if (next !== NEW_AREA) {
      onChange(next ? Number(next) : null)
      return
    }
    setOpen(true)
    if (!steppingRef.current) setFocusRequest(n => n + 1)
  }

  // Escape anywhere in the open group cancels it.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    e.preventDefault()
    e.stopPropagation()
    // A request already sent cannot be cancelled; stay open to show its result.
    if (!pendingRef.current) cancel()
  }

  return (
    <div className="p-field" onKeyDown={handleKeyDown}>
      <label className="p-label" htmlFor={selectId}>Area</label>
      <select
        id={selectId}
        ref={selectRef}
        className="p-select"
        value={effective === null ? '' : String(effective)}
        onKeyDown={e => {
          steppingRef.current =
            !e.altKey && (e.key.startsWith('Arrow') || e.key === 'End' || e.key === 'PageDown')
        }}
        onPointerDown={() => {
          steppingRef.current = false
        }}
        onChange={e => handleSelect(e.target.value)}
      >
        <option value="">No area</option>
        {!areas && value !== null && (
          <option value={String(value)}>
            {(value === currentAreaId && currentAreaName) || 'Current area'}
          </option>
        )}
        {areas?.map(a => (
          <option key={a.id} value={String(a.id)}>{a.name}</option>
        ))}
        <option value={NEW_AREA}>+ New area…</option>
      </select>

      {open && (
        <div className="p-new-area">
          <input
            ref={inputRef}
            type="text"
            className="p-input"
            aria-label="New area name"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            value={draft}
            onChange={e => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault() // never submits the project form
              if (!e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) void add()
            }}
          />
          <button type="button" className="p-btn tap-target" disabled={pending} onClick={() => void add()}>
            Add
          </button>
          <button type="button" className="p-btn tap-target" disabled={pending} onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {error && <p id={errorId} className="p-field-error" role="alert">{error}</p>}

      {!areas && query.isError && (
        <div className="p-new-area">
          <p className="p-field-error" role="alert">Failed to load areas.</p>
          <button type="button" className="p-btn tap-target" onClick={() => query.refetch()}>Retry</button>
        </div>
      )}
    </div>
  )
}
