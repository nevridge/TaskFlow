import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { AreaResponseDto } from '@/api/areas'
import { DeleteAreaDialog } from '@/components/DeleteAreaDialog'
import {
  useAreasQuery,
  useCreateAreaMutation,
  useDeleteAreaMutation,
  useRenameAreaMutation,
  useReorderAreasMutation,
} from '@/hooks/useAreas'
import { getApiErrorMessage } from '@/lib/api-error'
import { insertionIndex, moveItem, targetIndex } from '@/lib/area-reorder'
import { validateAreaName } from '@/lib/area-validation'

interface AreasSectionProps {
  /** Whether the settings drawer is open; areas are only fetched while it is. */
  open: boolean
  onDialogOpenChange?: (dialogOpen: boolean) => void
}

type Editor = { kind: 'add' } | { kind: 'rename'; id: number }

interface Drag {
  id: number
  pointerId: number
  /** Last pointer position, so a scroll can recompute the target. */
  y: number
  insert: number
}

function formatCount(count: number): string {
  if (count === 0) return 'No projects'
  return count === 1 ? '1 project' : `${count} projects`
}

export function AreasSection({ open, onDialogOpenChange }: AreasSectionProps) {
  const query = useAreasQuery({ enabled: open })
  const createMutation = useCreateAreaMutation()
  const renameMutation = useRenameAreaMutation()
  const reorderMutation = useReorderAreasMutation()
  const deleteMutation = useDeleteAreaMutation()
  const areas = query.data?.data

  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AreaResponseDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [drag, setDrag] = useState<Drag | null>(null)

  const titleId = useId()
  const hintId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const openRef = useRef(open)
  const reorderPendingRef = useRef(false)
  const directDeletePendingRef = useRef(false)
  const deletedRef = useRef(false)
  /** Handle to keep focused while its row moves (and moves back on failure). */
  const refocusHandleRef = useRef<number | null>(null)
  /** Selector to focus once it is rendered again (the pencil or "+ Add area"). */
  const focusAfterRef = useRef<string | null>(null)

  // The drawer stays mounted when closed, so editors and errors are cleared here.
  const [seenOpen, setSeenOpen] = useState(open)
  if (seenOpen !== open) {
    setSeenOpen(open)
    if (!open) {
      setEditor(null)
      setDeleteTarget(null)
      setError(null)
      setAnnouncement('')
      setDrag(null)
    }
  }

  useEffect(() => {
    openRef.current = open
    if (open) return
    dragRef.current = null
    refocusHandleRef.current = null
    focusAfterRef.current = null
  }, [open])

  const dialogOpen = deleteTarget !== null
  // A passive effect, so after a delete it runs after the dialog's focus trap has restored focus.
  useEffect(() => {
    onDialogOpenChange?.(dialogOpen)
    if (!dialogOpen && deletedRef.current) {
      deletedRef.current = false
      listRef.current?.focus()
    }
  }, [dialogOpen, onDialogOpenChange])

  const orderKey = areas?.map(a => a.id).join(',')
  // Moving DOM nodes can drop focus to body.
  useLayoutEffect(() => {
    const id = refocusHandleRef.current
    if (id === null) return
    const handle = sectionRef.current?.querySelector<HTMLElement>(`[data-area-handle="${id}"]`)
    const active = document.activeElement
    if (handle && (active === handle || active === document.body)) handle.focus()
  }, [orderKey])

  useLayoutEffect(() => {
    if (!focusAfterRef.current) return
    const target = sectionRef.current?.querySelector<HTMLElement>(focusAfterRef.current)
    if (!target) return
    focusAfterRef.current = null
    target.focus()
  })

  const updateDrag = useCallback((y: number) => {
    const current = dragRef.current
    const list = listRef.current
    if (!current || !list) return
    const rows = Array.from(list.querySelectorAll('[data-area-row]'), el => el.getBoundingClientRect())
    const next = { ...current, y, insert: insertionIndex(y, rows) }
    dragRef.current = next
    setDrag(next)
  }, [])

  const endDrag = useCallback(() => {
    dragRef.current = null
    setDrag(null)
  }, [])

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const handleScroll = () => {
      if (dragRef.current) updateDrag(dragRef.current.y)
    }
    // Capture on window: focus may not be on the handle, and the drawer must not see this Escape.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      endDrag()
    }
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('keydown', handleKey, true)
    document.documentElement.classList.add('area-dragging')
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('keydown', handleKey, true)
      document.documentElement.classList.remove('area-dragging')
    }
  }, [dragging, updateDrag, endDrag])

  function reorder(from: number, to: number) {
    if (!areas || reorderPendingRef.current) return
    const moved = areas[from]
    reorderPendingRef.current = true
    refocusHandleRef.current = moved.id
    setError(null)
    setAnnouncement(`${moved.name} moved to position ${to + 1} of ${areas.length}`)
    reorderMutation
      .mutateAsync(moveItem(areas, from, to).map(a => a.id))
      .catch((err: unknown) => setError(getApiErrorMessage(err, 'Could not save the new order.')))
      .finally(() => {
        reorderPendingRef.current = false
      })
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const to = index + (e.key === 'ArrowUp' ? -1 : 1)
    if (!areas || dragRef.current || to < 0 || to >= areas.length) return
    reorder(index, to)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, id: number, index: number) {
    // No touch drag, including on touchscreens whose primary pointer is a mouse.
    if (e.button !== 0 || e.pointerType === 'touch') return
    if (!areas || areas.length < 2 || reorderPendingRef.current) return
    e.preventDefault() // no text selection while dragging
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const next = { id, pointerId: e.pointerId, y: e.clientY, insert: index }
    dragRef.current = next
    setDrag(next)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== e.pointerId) return
    updateDrag(e.clientY)
    const { id, insert } = dragRef.current
    endDrag()
    e.currentTarget.focus()
    const from = areas?.findIndex(a => a.id === id) ?? -1
    if (from < 0) return
    const to = targetIndex(from, insert)
    if (to !== from) reorder(from, to)
  }

  async function handleDelete(area: AreaResponseDto) {
    setError(null)
    if (area.projectCount > 0) {
      setDeleteTarget(area)
      return
    }
    if (directDeletePendingRef.current) return
    directDeletePendingRef.current = true
    try {
      await deleteMutation.mutateAsync({ id: area.id })
      if (openRef.current) listRef.current?.focus()
    } catch (err) {
      const result = await query.refetch()
      if (!openRef.current) return
      const fresh = result.data?.data?.find(a => a.id === area.id)
      // It gained projects elsewhere: ask what should happen to them.
      if (fresh && fresh.projectCount > 0) setDeleteTarget(fresh)
      else setError(getApiErrorMessage(err, 'Could not delete area.'))
    } finally {
      directDeletePendingRef.current = false
    }
  }

  function openEditor(next: Editor) {
    focusAfterRef.current = null
    setError(null)
    setEditor(next)
  }

  function closeEditor(returnTo: string) {
    focusAfterRef.current = returnTo
    setEditor(null)
  }

  const dragFrom = drag && areas ? areas.findIndex(a => a.id === drag.id) : -1
  // No line when the drop would not move the row.
  const dropAt = drag && dragFrom >= 0 && targetIndex(dragFrom, drag.insert) !== dragFrom ? drag.insert : null
  const showHint = (areas?.length ?? 0) >= 2

  return (
    <section className="settings-section" ref={sectionRef} aria-labelledby={titleId}>
      <h3 id={titleId} className="settings-section-title">Areas</h3>
      <div role="status" className="sr-only">{announcement}</div>

      {!areas && query.isError && (
        <>
          <p className="area-error" role="alert">Failed to load areas.</p>
          <button type="button" className="area-text-btn tap-target" onClick={() => query.refetch()}>
            Retry
          </button>
        </>
      )}
      {!areas && !query.isError && open && <p className="area-hint-status" role="status">Loading areas…</p>}

      {areas && (
        <>
          <ul className="area-list" ref={listRef} tabIndex={-1} aria-labelledby={titleId}>
            {areas.map((area, index) => {
              const renaming = editor?.kind === 'rename' && editor.id === area.id
              return (
                <li
                  key={area.id}
                  data-area-row={area.id}
                  className={`settings-row area-row${drag?.id === area.id ? ' is-dragging' : ''}`}
                >
                  {dropAt === index && <span className="area-drop-line area-drop-line--before" aria-hidden="true" />}
                  <button
                    type="button"
                    className="area-handle"
                    data-area-handle={area.id}
                    aria-label={`Reorder ${area.name}`}
                    aria-describedby={showHint ? hintId : undefined}
                    disabled={renaming}
                    onKeyDown={e => handleKeyDown(e, index)}
                    onBlur={e => {
                      // The user moved on; a later order change must not pull focus back.
                      if (e.relatedTarget) refocusHandleRef.current = null
                    }}
                    onPointerDown={e => handlePointerDown(e, area.id, index)}
                    onPointerMove={e => {
                      if (dragRef.current?.pointerId === e.pointerId) updateDrag(e.clientY)
                    }}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={endDrag}
                    onLostPointerCapture={endDrag}
                  >
                    <HandleIcon />
                  </button>
                  {renaming ? (
                    <AreaNameEditor
                      initialName={area.name}
                      inputLabel="Area name"
                      saveLabel="Save name"
                      cancelLabel="Cancel rename"
                      errorFallback="Could not rename area."
                      onSave={async name => {
                        if (name !== area.name) await renameMutation.mutateAsync({ id: area.id, name })
                      }}
                      onClose={() => closeEditor(`[data-area-rename="${area.id}"]`)}
                    />
                  ) : (
                    <>
                      <span className="settings-row-label area-label">
                        <span className="area-name">{area.name}</span>
                        <span className="area-count">{formatCount(area.projectCount)}</span>
                      </span>
                      <button
                        type="button"
                        className="area-icon-btn tap-target"
                        data-area-rename={area.id}
                        aria-label={`Rename ${area.name}`}
                        onClick={() => openEditor({ kind: 'rename', id: area.id })}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        className="area-icon-btn area-icon-btn--danger tap-target"
                        aria-label={`Delete ${area.name}`}
                        onClick={() => handleDelete(area)}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                  {dropAt === areas.length && index === areas.length - 1 && (
                    <span className="area-drop-line area-drop-line--after" aria-hidden="true" />
                  )}
                </li>
              )
            })}
          </ul>

          {showHint && (
            <p id={hintId} className="area-hint">
              <span className="area-hint-drag">Drag a handle to reorder, or focus it and press Alt+↑ / Alt+↓.</span>
              <span className="area-hint-keys">Press Alt+↑ / Alt+↓ to reorder.</span>
            </p>
          )}
          {error && <p className="area-error" role="alert">{error}</p>}

          {editor?.kind === 'add' ? (
            <div className="area-add-row">
              <AreaNameEditor
                initialName=""
                inputLabel="New area name"
                saveLabel="Save area"
                cancelLabel="Cancel add"
                errorFallback="Could not add area."
                onSave={name => createMutation.mutateAsync(name)}
                onClose={() => closeEditor('[data-area-add]')}
              />
            </div>
          ) : (
            <button
              type="button"
              className="area-text-btn tap-target"
              data-area-add
              onClick={() => openEditor({ kind: 'add' })}
            >
              + Add area
            </button>
          )}
        </>
      )}

      {deleteTarget && (
        <DeleteAreaDialog
          area={deleteTarget}
          areas={areas ?? []}
          listRef={listRef}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={() => {
            deletedRef.current = true
            setDeleteTarget(null)
          }}
        />
      )}
    </section>
  )
}

interface AreaNameEditorProps {
  initialName: string
  inputLabel: string
  saveLabel: string
  cancelLabel: string
  errorFallback: string
  /** Receives the trimmed, valid name; should reject on failure. */
  onSave: (name: string) => Promise<unknown>
  onClose: () => void
}

/** Inline name field shared by rename and add. The draft lives here, so closing discards it. */
function AreaNameEditor({
  initialName,
  inputLabel,
  saveLabel,
  cancelLabel,
  errorFallback,
  onSave,
  onClose,
}: AreaNameEditorProps) {
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => {
      mounted.current = false
    }
  }, [])

  async function save() {
    if (pendingRef.current) return
    // Before Save is disabled: a focused button that becomes disabled drops focus to body.
    inputRef.current?.focus()
    const invalid = validateAreaName(name)
    setError(invalid)
    if (invalid) return
    pendingRef.current = true
    setPending(true)
    try {
      await onSave(name.trim())
      if (mounted.current) onClose()
    } catch (err) {
      pendingRef.current = false
      if (!mounted.current) return
      setPending(false)
      setError(getApiErrorMessage(err, errorFallback))
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const composing = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
    if (e.key === 'Escape') {
      // Always stopped, even mid-composition, so the drawer's document listener never sees it.
      e.stopPropagation()
      if (composing) return
      e.preventDefault()
      // A request already sent cannot be cancelled; stay open to show its result.
      if (!pendingRef.current) onClose()
    } else if (e.key === 'Enter' && e.target === inputRef.current) {
      e.preventDefault()
      if (!composing) void save()
    }
  }

  return (
    <div className="area-editor" onKeyDown={handleKeyDown}>
      <input
        ref={inputRef}
        type="text"
        className="area-input"
        aria-label={inputLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <button
        type="button"
        className="area-icon-btn area-icon-btn--save tap-target"
        aria-label={saveLabel}
        disabled={pending}
        onClick={() => void save()}
      >
        <CheckIcon />
      </button>
      <button
        type="button"
        className="area-icon-btn tap-target"
        aria-label={cancelLabel}
        disabled={pending}
        onClick={onClose}
      >
        <CrossIcon />
      </button>
      {error && <p id={errorId} className="area-editor-error" role="alert">{error}</p>}
    </div>
  )
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

function HandleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {[6, 12, 18].flatMap(cy => [9, 15].map(cx => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" />))}
    </svg>
  )
}

const PencilIcon = () => (
  <Icon>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
)
const TrashIcon = () => (
  <Icon>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </Icon>
)
const CheckIcon = () => (
  <Icon>
    <path d="M5 12l5 5 9-10" />
  </Icon>
)
const CrossIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)
