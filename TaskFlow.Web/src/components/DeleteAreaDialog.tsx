import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { AreaDeleteChoice, AreaResponseDto } from '@/api/areas'
import type { ProjectResponseDto } from '@/api/projects'
import { useDeleteAreaMutation } from '@/hooks/useAreas'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useProjectsQuery } from '@/hooks/useProjects'
import { getApiErrorMessage } from '@/lib/api-error'
import { validateAreaName } from '@/lib/area-validation'

interface DeleteAreaDialogProps {
  /** Snapshot of the area being deleted. */
  area: AreaResponseDto
  /** All areas in display order. */
  areas: AreaResponseDto[]
  /** Receives focus when the opening trash button no longer exists. */
  listRef: RefObject<HTMLElement | null>
  onCancel: () => void
  onDeleted: () => void
}

type Choice = 'move' | 'new' | 'none'

export function DeleteAreaDialog({ area, areas, listRef, onCancel, onDeleted }: DeleteAreaDialogProps) {
  const uid = useId()
  const titleId = `${uid}-title`
  const radioName = `${uid}-choice`
  const newHintId = `${uid}-new-hint`
  const noneHintId = `${uid}-none-hint`
  const nameErrorId = `${uid}-name-error`

  const projectsQuery = useProjectsQuery()
  const deleteMutation = useDeleteAreaMutation()
  const panelRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef(false)

  const [choice, setChoice] = useState<Choice | null>(null)
  const [targetId, setTargetId] = useState('')
  const [newName, setNewName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The list as it was when Delete was pressed: the refetch after the delete would otherwise empty it.
  const [frozen, setFrozen] = useState<ProjectResponseDto[] | null>(null)

  // Declared before the focus effect below so the opener is captured before the dialog takes focus.
  useFocusTrap(panelRef, true, { fallbackRef: listRef })

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('input[type="radio"]:not(:disabled)')?.focus()
  }, [])

  // On window, so it runs after the drawer's document listener (which ignores Escape while we are open).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return
      e.preventDefault()
      if (!pendingRef.current) onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const live = projectsQuery.data?.data?.filter(p => p.areaId === area.id)
  const projects = frozen ?? live
  const count = projects?.length ?? area.projectCount
  const others = areas.filter(a => a.id !== area.id)
  const target = others.some(a => String(a.id) === targetId) ? targetId : ''
  const trimmedName = newName.trim()
  const nameTooLong = trimmedName !== '' && validateAreaName(newName) !== null

  function selectedChoice(): AreaDeleteChoice | null {
    if (choice === 'move') return target ? { moveToAreaId: Number(target) } : null
    if (choice === 'new') return validateAreaName(newName) ? null : { newAreaName: trimmedName }
    return choice === 'none' ? { noArea: true } : null
  }
  const canConfirm = !pending && projects !== undefined && selectedChoice() !== null

  async function confirm() {
    const selected = selectedChoice()
    if (pendingRef.current || !projects || !selected) return
    pendingRef.current = true
    // Before the buttons are disabled, so focus stays inside the dialog.
    panelRef.current?.focus()
    setFrozen(projects)
    setPending(true)
    setError(null)
    try {
      await deleteMutation.mutateAsync({ id: area.id, choice: selected })
      onDeleted()
    } catch (err) {
      pendingRef.current = false
      setPending(false)
      setFrozen(null)
      setError(getApiErrorMessage(err, 'Could not delete area.'))
    }
  }

  function renderProjects() {
    if (!projects) {
      if (!projectsQuery.isError) return <p className="area-dialog-status" role="status">Loading projects…</p>
      return (
        <div>
          <p className="area-dialog-error" role="alert">Failed to load projects.</p>
          <button type="button" className="area-btn tap-target" onClick={() => projectsQuery.refetch()}>
            Retry
          </button>
        </div>
      )
    }
    return (
      <>
        <p>
          {count === 1 ? '1 project' : `${count} projects`} will be left without an area:
        </p>
        <ul className="area-dialog-projects">
          {projects.map(p => (
            <li key={p.id}>
              {p.name}
              {p.isArchived && <span className="area-dialog-badge">Archived</span>}
            </li>
          ))}
        </ul>
      </>
    )
  }

  const choiceClass = (value: Choice) => `area-choice${choice === value ? ' is-selected' : ''}`

  return createPortal(
    <>
      <div
        className="area-dialog-backdrop"
        aria-hidden="true"
        // Keeps focus in the dialog when the click does not close it.
        onMouseDown={e => e.preventDefault()}
        onClick={() => {
          if (!pendingRef.current) onCancel()
        }}
      />
      <div
        ref={panelRef}
        className="area-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <form
          noValidate
          onSubmit={e => {
            e.preventDefault()
            void confirm()
          }}
        >
          <h2 id={titleId} className="area-dialog-title">Delete the “{area.name}” area?</h2>
          {renderProjects()}
          <fieldset className="area-dialog-fieldset">
            <legend>What should happen to them?</legend>

            <div className={choiceClass('move')}>
              <label className="area-choice-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={choice === 'move'}
                  disabled={others.length === 0}
                  onChange={() => setChoice('move')}
                />
                Move them to another area
              </label>
              <select
                className="area-input area-choice-control"
                aria-label="Target area"
                value={target}
                disabled={others.length === 0}
                onChange={e => {
                  setTargetId(e.target.value)
                  setChoice('move')
                }}
              >
                <option value="" disabled>Choose an area</option>
                {others.map(a => (
                  <option key={a.id} value={String(a.id)}>{a.name}</option>
                ))}
              </select>
            </div>

            <div className={choiceClass('new')}>
              <label className="area-choice-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={choice === 'new'}
                  aria-describedby={trimmedName ? newHintId : undefined}
                  onChange={() => setChoice('new')}
                />
                Move them to a new area
              </label>
              {/* Selected by typing or clicking, never by focus alone. */}
              <input
                type="text"
                className="area-input area-choice-control"
                aria-label="New area name"
                aria-invalid={nameTooLong ? true : undefined}
                aria-describedby={nameTooLong ? nameErrorId : undefined}
                value={newName}
                onChange={e => {
                  setNewName(e.target.value)
                  setChoice('new')
                }}
                onClick={() => setChoice('new')}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  // Never lets Enter here confirm a different choice.
                  e.preventDefault()
                  if (choice === 'new' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) void confirm()
                }}
              />
              {nameTooLong && (
                <p id={nameErrorId} className="area-dialog-error" role="alert">{validateAreaName(newName)}</p>
              )}
              {trimmedName && (
                <p id={newHintId} className="area-choice-hint">
                  “{trimmedName}” will be created and the {count === 1 ? '1 project' : `${count} projects`} moved
                  into it.
                </p>
              )}
            </div>

            <div className={choiceClass('none')}>
              <label className="area-choice-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={choice === 'none'}
                  aria-describedby={noneHintId}
                  onChange={() => setChoice('none')}
                />
                Leave them without an area
              </label>
              <p id={noneHintId} className="area-choice-hint">
                They’ll show under “No area”. Their tasks aren’t changed.
              </p>
            </div>
          </fieldset>

          {error && <p className="area-dialog-error" role="alert">{error}</p>}

          <div className="area-dialog-actions">
            <button type="button" className="area-btn tap-target" disabled={pending} onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="area-btn area-btn--danger tap-target" disabled={!canConfirm}>
              {choice === 'move' || choice === 'new' ? 'Delete area and move projects' : 'Delete area'}
            </button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  )
}
