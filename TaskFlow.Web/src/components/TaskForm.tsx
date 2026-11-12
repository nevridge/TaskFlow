import { type FormEvent, type KeyboardEvent, type Ref, useEffect, useRef, useState } from 'react'
import type { TaskItemResponseDto, CreateTaskItemDto } from '@/api/client/types.gen'
import { normalizeProjectId } from '@/lib/project-errors'
import { BLOCK_REASON_MAX_LENGTH } from '@/components/BlockControls'
import { isCompleted, normalizeStatus, toRequestStatus, type RequestStatus } from '@/lib/task-status'
import { todayISO } from '@/lib/journal-utils'
import { buildProjectOptions, type ProjectOption } from '@/lib/project-options'
import {
  COMPLETED_PARENT_STATUS_HINT,
  isParentOptionDisabled,
  parentOptionLabel,
  type ParentTaskOption,
} from '@/lib/parent-options'

export type { ParentTaskOption }

export type TaskFormPayload = CreateTaskItemDto & {
  parentTaskItemId?: number | null
  /** number = project, null = "No project", undefined = not set */
  projectId?: number | null
  /** Only present while the status is Blocked. "" clears the reason; omitted keeps it (PUT semantics). */
  blockedReason?: string
  /**
   * Edit only. undefined = unchanged or not shown, 'YYYY-MM-DD' = set/change, null = clear the planned journal day.
   * Never an empty string.
   */
  plannedDay?: string | null
}

export type { ProjectOption }

type TaskFormModel = TaskItemResponseDto & {
  parentTaskItemId?: number | null
}

interface Props {
  task?: TaskFormModel
  availableParents?: ParentTaskOption[]
  /** All projects (archived included); the form filters archived ones itself. Parents fetch, the form does not. */
  projects?: ProjectOption[]
  /** Preselected project for a new task. Ignored when editing or when the project is archived/unknown. */
  defaultProjectId?: number | null
  /** Marks the Project select invalid and focuses it (e.g. after a 422/404). */
  projectInvalid?: boolean
  onProjectChange?: () => void
  isSaving?: boolean
  onSubmit: (data: TaskFormPayload) => void
  onCancel: () => void
  /** Lets a parent focus the title field (e.g. the Tasks page after scrolling the panel into view). */
  titleInputRef?: Ref<HTMLInputElement>
  /** Open subtasks drive the status: the select is read-only and shows `displayStatus`; the stored status is submitted unchanged. */
  statusLocked?: boolean
  /** Derived status shown while locked (display only, never submitted). */
  displayStatus?: string | null
  /** Fires when the parent or status select changes, so the page can clear a stale save error. */
  onParentOrStatusChange?: () => void
  /** Bump to snap the planned day field back to the stored day (e.g. after a failed clear). */
  plannedDayRevertToken?: number
}

export function TaskForm({
  task,
  availableParents = [],
  projects = [],
  defaultProjectId,
  projectInvalid = false,
  onProjectChange,
  isSaving = false,
  onSubmit,
  onCancel,
  titleInputRef,
  statusLocked = false,
  displayStatus,
  onParentOrStatusChange,
  plannedDayRevertToken = 0,
}: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<string>((task?.status ?? 'draft').toLowerCase())
  const [priority, setPriority] = useState<string>((task?.priority ?? 'low').toLowerCase())
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const originalStatus = normalizeStatus(task?.status)
  // Blocking is only valid from Todo (or while already Blocked); the server answers 422 otherwise.
  const canChooseBlocked = originalStatus === 'Todo' || originalStatus === 'InProgress' || originalStatus === 'Blocked'
  // Only Todo (or Blocked, or an already In Progress task) can move to In Progress; Draft/Completed answer 422.
  const canChooseInProgress = !task || (originalStatus !== 'Draft' && originalStatus !== 'Completed')
  const [blockedReason, setBlockedReason] = useState(task?.blockedReason ?? '')
  const [parentTaskId, setParentTaskId] = useState<string>(task?.parentTaskItemId ? String(task.parentTaskItemId) : '')
  // A Completed subtask cannot be reopened under a Completed parent (server 422). Derived from the live parent
  // selection each render, so clearing or changing the parent re-enables the open statuses (reopen + detach).
  const selectedParent = parentTaskId ? availableParents.find(p => String(p.id) === parentTaskId) : undefined
  const openStatusesBlocked = !!task && originalStatus === 'Completed' && !statusLocked && isCompleted(selectedParent?.status)
  const statusDescribedBy = statusLocked ? 'status-locked-hint' : openStatusesBlocked ? 'status-parent-completed-hint' : undefined

  const serverProjectId = normalizeProjectId(task?.projectId)
  const defaultActive =
    !task && defaultProjectId != null && projects.some(p => p.id === defaultProjectId && !p.isArchived)
      ? String(defaultProjectId)
      : ''
  const [projectId, setProjectId] = useState<string>(
    serverProjectId !== null ? String(serverProjectId) : defaultActive,
  )
  // When a refetch changes the task's server-side project, the selection follows it.
  // React's "adjusting state while rendering" pattern; guarded by the seen-value
  // comparison, so the re-render finds them equal and cannot loop. Other fields are untouched.
  const [seenServerProjectId, setSeenServerProjectId] = useState(serverProjectId)
  if (task && seenServerProjectId !== serverProjectId) {
    setSeenServerProjectId(serverProjectId)
    setProjectId(serverProjectId !== null ? String(serverProjectId) : '')
  }
  // Planned journal day (edit only). Resyncs to the stored day when a refetch changes it or the revert token bumps.
  const stored = task?.currentJournalDate ?? ''
  const storedIsPast = stored !== '' && stored < todayISO()
  const showPlannedDay = !!task && originalStatus !== 'Completed'
  const plannedDisabled = showPlannedDay && normalizeStatus(status) === 'Completed'
  const [plannedDay, setPlannedDay] = useState(stored)
  const [plannedDayError, setPlannedDayError] = useState<string | null>(null)
  const [seenStored, setSeenStored] = useState(stored)
  const [seenToken, setSeenToken] = useState(plannedDayRevertToken)
  if (stored !== seenStored || plannedDayRevertToken !== seenToken) {
    setSeenStored(stored)
    setSeenToken(plannedDayRevertToken)
    setPlannedDay(stored)
    setPlannedDayError(null)
  }
  const plannedRef = useRef<HTMLInputElement>(null)
  const projectRef = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    if (projectInvalid) projectRef.current?.focus()
  }, [projectInvalid])
  const projectOptions = buildProjectOptions(task, projects, projectId ? Number(projectId) : null)
  // A selected id with no option (project deleted) is shown as, and submitted as, "No project".
  const effectiveProjectId = projectOptions.some(o => o.value === projectId) ? projectId : ''

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isSaving) return
    const planChanged = showPlannedDay && !plannedDisabled && plannedDay !== stored
    if (planChanged && plannedDay !== '' && plannedDay < todayISO()) {
      setPlannedDayError('Pick today or a later day.')
      plannedRef.current?.focus()
      return
    }
    // While locked, local state may hold a stale user choice; send the stored status instead.
    const effectiveStatus = statusLocked ? (task?.status ?? status).toLowerCase() : status
    const normalized = normalizeStatus(effectiveStatus)
    onSubmit({
      title,
      description: description || null,
      // The form keeps the lowercased key; task-status.ts maps it to the wire value (`inProgress`).
      status: (normalized ? toRequestStatus(normalized) : effectiveStatus) as RequestStatus,
      priority: priority as 'low' | 'medium' | 'high',
      // dueDate is a YYYY-MM-DD calendar date from <input type="date">; a cleared input sends null, never ""
      dueDate: dueDate || null,
      parentTaskItemId: parentTaskId ? Number(parentTaskId) : undefined,
      projectId: effectiveProjectId ? Number(effectiveProjectId) : null,
      // A non-empty reason with a non-Blocked status is a 422, so it is only sent while Blocked.
      // Never while locked: the stored reason is left alone.
      ...(!statusLocked && status === toRequestStatus('Blocked') && { blockedReason: blockedReason.trim() }),
      // Only a changed value is sent; an unchanged (even past) stored day leaves the key out.
      ...(planChanged && { plannedDay: plannedDay || null }),
    })
  }

  // Escape cancels like the Cancel button. Guards are ordered cheapest first.
  // The textarea is exempt (content-independent rule) so Escape never discards typed text there.
  // stopPropagation keeps document/window Escape listeners (settings, help, history) from also reacting.
  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== 'Escape') return
    if (e.defaultPrevented) return
    // Safari's composition-ending Escape reports isComposing=false but keyCode 229.
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    if (isSaving) return
    if (e.target instanceof HTMLTextAreaElement) return
    e.preventDefault()
    e.stopPropagation()
    onCancel()
  }

  return (
    <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="t-form">
      <div className="t-field">
        <label htmlFor="title" className="t-label">Title</label>
        <input id="title" ref={titleInputRef} className="t-input" value={title} onChange={e => setTitle(e.target.value)} required />
      </div>
      <div className="t-field">
        <label htmlFor="description" className="t-label">Description</label>
        <textarea
          id="description"
          className="t-input"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
        />
      </div>
      <div className="t-form-row">
        <div className="t-field">
          <label htmlFor="status" className="t-label">Status</label>
          <select
            id="status"
            className="t-input"
            value={statusLocked ? (normalizeStatus(displayStatus ?? task?.status)?.toLowerCase() ?? status) : status}
            disabled={statusLocked}
            aria-describedby={statusDescribedBy}
            onChange={e => { setStatus(e.target.value); onParentOrStatusChange?.() }}
          >
            <option value="draft" disabled={openStatusesBlocked}>Draft</option>
            <option value="todo" disabled={openStatusesBlocked}>Todo</option>
            <option
              value="inprogress"
              disabled={openStatusesBlocked || (!statusLocked && !canChooseInProgress)}
              title={canChooseInProgress ? undefined : 'Set to Todo first'}
            >
              {canChooseInProgress || statusLocked ? 'In Progress' : 'In Progress (set to Todo first)'}
            </option>
            <option value="blocked" disabled={openStatusesBlocked || (!statusLocked && !canChooseBlocked)}>Blocked</option>
            <option value="completed">Completed</option>
          </select>
          {statusLocked && (
            <p id="status-locked-hint" className="t-detail-hint">
              Follows open subtasks. Complete or remove them to change it.
            </p>
          )}
          {openStatusesBlocked && (
            <p id="status-parent-completed-hint" className="t-detail-hint">
              {COMPLETED_PARENT_STATUS_HINT}
            </p>
          )}
        </div>
        <div className="t-field">
          <label htmlFor="priority" className="t-label">Priority</label>
          <select id="priority" className="t-input" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      {!statusLocked && status === 'blocked' && (
        <div className="t-field">
          <label htmlFor="blockedReason" className="t-label">Blocked reason (optional)</label>
          <input
            id="blockedReason"
            className="t-input"
            value={blockedReason}
            maxLength={BLOCK_REASON_MAX_LENGTH}
            onChange={e => setBlockedReason(e.target.value)}
          />
        </div>
      )}
      <div className="t-field">
        <label htmlFor="dueDate" className="t-label">Due Date</label>
        <input id="dueDate" type="date" className="t-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </div>
      {showPlannedDay && (
        <div className="t-field">
          <label htmlFor="plannedDay" className="t-label">Planned day</label>
          <div className="t-planned-day-row">
            <input
              id="plannedDay"
              ref={plannedRef}
              type="date"
              className="t-input"
              value={plannedDay}
              disabled={plannedDisabled}
              min={storedIsPast ? undefined : todayISO()}
              aria-invalid={plannedDayError ? 'true' : undefined}
              aria-describedby={plannedDayError ? 'plannedDay-hint plannedDay-error' : 'plannedDay-hint'}
              onChange={e => { setPlannedDay(e.target.value); setPlannedDayError(null) }}
            />
            {plannedDay !== '' && !plannedDisabled && (
              <button
                type="button"
                className="t-btn"
                aria-label="Clear planned day"
                onClick={() => { setPlannedDay(''); setPlannedDayError(null); plannedRef.current?.focus() }}
              >
                Clear
              </button>
            )}
          </div>
          <p id="plannedDay-hint" className="t-detail-hint">
            {plannedDisabled ? "Completed tasks can't be planned." : 'Journal day. Empty = not planned. Separate from Due Date.'}
          </p>
          {plannedDayError && <p id="plannedDay-error" className="t-inline-error" role="alert">{plannedDayError}</p>}
        </div>
      )}
      <div className="t-field">
        <label htmlFor="projectId" className="t-label">Project</label>
        <select
          id="projectId"
          ref={projectRef}
          className="t-input"
          value={effectiveProjectId}
          aria-invalid={projectInvalid ? 'true' : undefined}
          onChange={e => { setProjectId(e.target.value); onProjectChange?.() }}
        >
          <option value="">No project</option>
          {projectOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="t-field">
        <label htmlFor="parentTaskId" className="t-label">Parent Task</label>
        <select
          id="parentTaskId"
          className="t-input"
          value={parentTaskId}
          onChange={e => { setParentTaskId(e.target.value); onParentOrStatusChange?.() }}
        >
          <option value="">None</option>
          {parentTaskId && !availableParents.some(p => String(p.id) === parentTaskId) && (
            <option value={parentTaskId} disabled>Current parent</option>
          )}
          {availableParents.map(parent => (
            <option key={parent.id} value={String(parent.id)} disabled={isParentOptionDisabled(parent, parentTaskId)}>
              {parentOptionLabel(parent)}
            </option>
          ))}
        </select>
      </div>
      <div className="t-form-actions">
        <button type="button" className="t-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="t-btn-primary" aria-busy={isSaving || undefined}>{isSaving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}
