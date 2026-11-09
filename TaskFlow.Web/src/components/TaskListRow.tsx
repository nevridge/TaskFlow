import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDateOnly } from '@/lib/utils'
import { formatMonthDay, formatShort, todayISO } from '@/lib/journal-utils'
import { BlockIcon, BlockReasonInput, BlockedReasonText } from '@/components/BlockControls'
import { COMPLETED_PARENT_ADD_SUBTASK_HINT } from '@/lib/parent-options'
import { getDerivedStatusTitle } from '@/lib/task-derived-status'
import { canBlock, getStatusLabel, isBlocked as isBlockedStatus, nextCycleStatus } from '@/lib/task-status'
import type { TaskItemResponseDto } from '@/api/client/types.gen'
import type { TaskOriginState } from '@/lib/task-origin'

type TaskRowModel = TaskItemResponseDto & {
  currentJournalDate?: string | null
  currentJournalEntryId?: number | null
  moveCount?: number
  daysTagged?: number
  parentTaskItemId?: number | null
  childTaskCount?: number
}

interface Props {
  task: TaskRowModel
  depth?: number
  childProgress?: string | null
  /** Status to show; defaults to the stored status. The Tasks page passes the status derived from open subtasks. */
  displayStatus?: string | null
  /** True while open subtasks drive the status: the badge is read-only and Block/Unblock are hidden. */
  statusLocked?: boolean
  /** Open direct subtasks; used for the locked badge's title. */
  openChildCount?: number
  onAddChild?: (task: TaskRowModel) => void
  isAddingChild?: boolean
  /** True when the STORED status is Completed: Add subtask stays focusable but does nothing. */
  addSubtaskDisabled?: boolean
  /** Router state for the title link (the Tasks page passes its origin so the detail back link returns to the filtered list). */
  detailState?: TaskOriginState
  onEdit: (task: TaskRowModel) => void
  onHistory: (task: TaskRowModel) => void
  onDelete: (task: TaskRowModel) => void
  onStatusCycle: (task: TaskRowModel) => void
  /** Block with an optional reason. Must reject on failure so the reason input can re-open with the typed text. */
  onBlock?: (task: TaskRowModel, reason: string) => Promise<void>
  /** Reason typed before a failed block that moved this row and rolled it back; re-opens the input with it. */
  blockRetryReason?: string | null
  onBlockRetryShown?: () => void
  onUnblock?: (task: TaskRowModel) => void
  /** Save a new reason for a Blocked task (""clears it). Must reject on failure. */
  onEditBlockedReason?: (task: TaskRowModel, reason: string) => Promise<void>
}

function isOverdue(dueDate: string | null | undefined, status: string | undefined): boolean {
  if (!dueDate) return false
  if ((status ?? '').toLowerCase() === 'completed') return false
  return dueDate < todayISO()
}

function isDueToday(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false
  return dueDate === todayISO()
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
)
const ClockIcon = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" /></svg>
)
const PencilIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
)
const XIcon = () => (
  <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
)

export function TaskListRow({
  task,
  depth = 0,
  childProgress,
  displayStatus,
  statusLocked = false,
  openChildCount = 0,
  onAddChild,
  isAddingChild = false,
  addSubtaskDisabled = false,
  detailState,
  onEdit,
  onHistory,
  onDelete,
  onStatusCycle,
  onBlock,
  blockRetryReason = null,
  onBlockRetryShown,
  onUnblock,
  onEditBlockedReason,
}: Props) {
  const [blocking, setBlocking] = useState(false)
  const [reasonEditing, setReasonEditing] = useState(false)
  const [blockDraft, setBlockDraft] = useState('')
  const submittingRef = useRef(false)
  const blockBtnRef = useRef<HTMLButtonElement>(null)
  const titleLinkRef = useRef<HTMLAnchorElement>(null)
  const reasonBtnRef = useRef<HTMLButtonElement>(null)
  const shownStatus = displayStatus ?? task.status
  const blocked = isBlockedStatus(shownStatus)
  const blockable = canBlock(shownStatus) && !!onBlock && !statusLocked
  // childTaskCount already excludes subtasks whose delete is pending.
  const childCount = Number(task.childTaskCount ?? 0)
  const deleteBlocked = childCount > 0
  const deleteHint = `Delete subtasks first (${childCount})`
  const deleteHintId = `del-hint-${task.id}`
  const addSubtaskHintId = `add-hint-${task.id}`

  // Adjusted during render (not in an effect) so the closed input never paints.
  const [appliedRetryReason, setAppliedRetryReason] = useState<string | null>(null)
  if (blockRetryReason !== appliedRetryReason) {
    setAppliedRetryReason(blockRetryReason)
    if (blockRetryReason !== null) {
      setBlockDraft(blockRetryReason)
      setBlocking(true)
    }
  }
  // Consumed once, so a later remount of this row does not re-open the input.
  useEffect(() => {
    if (blockRetryReason !== null) onBlockRetryShown?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockRetryReason])

  // When a lock engages, the badge that held focus is replaced by a non-focusable span; keep focus in the row.
  const wasLockedRef = useRef(statusLocked)
  useEffect(() => {
    if (statusLocked && !wasLockedRef.current) {
      const active = document.activeElement
      // Browsers blur an element that loses its tabindex; jsdom does not, so also check focusability.
      const stillFocusable = !!active?.matches('a[href], button, input, select, textarea, [tabindex]')
      if (!active || active === document.body || !active.isConnected || !stillFocusable) titleLinkRef.current?.focus()
    }
    wasLockedRef.current = statusLocked
  }, [statusLocked])

  const status = (shownStatus ?? 'draft').toLowerCase()
  const statusLabel = getStatusLabel(shownStatus ?? 'draft')
  const nextRequest = nextCycleStatus(shownStatus)
  const nextLabel = nextRequest ? getStatusLabel(nextRequest) : null
  const priority = (task.priority ?? 'low').toLowerCase()
  const overdue = isOverdue(task.dueDate, shownStatus)
  const moveCount = task.moveCount ?? 0
  const daysTagged = task.daysTagged ?? 0
  const isCompleted = status === 'completed'
  const highDeferral = moveCount >= 3
  // Informational only: no overdue styling, and hidden once completed (the stored plan is not shown for done tasks).
  const plannedDay = task.currentJournalDate
  const showPlanned = !!plannedDay && !isCompleted
  const showDeferral = moveCount > 0 || daysTagged > 1
  const boldTitle = isDueToday(task.dueDate) && priority === 'high'

  const rowClasses = [
    't-list-row',
    isCompleted && 't-row--completed',
    !isCompleted && overdue && 't-row--overdue',
    !isCompleted && !overdue && highDeferral && 't-row--high-deferral',
    blocked && 't-row--blocked',
  ].filter(Boolean).join(' ')

  async function submitBlock(reason: string) {
    if (submittingRef.current || !onBlock) return
    submittingRef.current = true
    setBlocking(false)
    // The row's primary control after blocking is the title link.
    const focusFrame = requestAnimationFrame(() => titleLinkRef.current?.focus())
    try {
      await onBlock(task, reason)
    } catch {
      // Re-open with the typed text (its autoFocus wins); the page shows the error message.
      cancelAnimationFrame(focusFrame)
      setBlockDraft(reason)
      setBlocking(true)
    } finally {
      submittingRef.current = false
    }
  }

  async function submitReason(reason: string) {
    setReasonEditing(false)
    requestAnimationFrame(() => titleLinkRef.current?.focus())
    if (reason === (task.blockedReason ?? '') || !onEditBlockedReason) return
    try {
      await onEditBlockedReason(task, reason)
    } catch {
      // The page shows the error; the previous reason is restored by the cache rollback.
    }
  }

  function cancelInput(via: 'escape' | 'blur', returnTo: 'block' | 'reason') {
    setBlocking(false)
    setReasonEditing(false)
    if (via === 'escape') {
      requestAnimationFrame(() => (returnTo === 'block' ? blockBtnRef : reasonBtnRef).current?.focus())
    }
  }

  return (
    <Fragment>
    <tr role="row" className={rowClasses}>
      <td role="cell" className="t-list-cell t-list-cell--title">
        <div className={`t-title-wrap t-depth-${depth}`}>
          <span className="t-tree-spacer" aria-hidden="true" />
          <div>
            <div className="t-title-line">
              {task.id !== undefined && task.id !== null && (
                <span className="t-task-id" aria-label={`Task ${task.id}`} role="img">#{task.id}</span>
              )}
              <Link ref={titleLinkRef} to={`/tasks/${task.id}`} state={detailState} className={`t-task-link${boldTitle ? ' t-title-bold' : ''}`}>
                {task.title}
              </Link>
            </div>
            {childProgress && <div className="t-deferral-line">{childProgress}</div>}
            {blocked && !statusLocked && !reasonEditing && (
              <BlockedReasonText
                ref={reasonBtnRef}
                className="t-blocked-reason"
                reason={task.blockedReason ?? ''}
                onEdit={() => setReasonEditing(true)}
              />
            )}
            {showDeferral && (
              <div className="t-deferral-line">
                {highDeferral && <span className="t-deferral-badge">{'↻'} {moveCount}</span>}
                {highDeferral && daysTagged > 1 && ' · '}
                {!highDeferral && moveCount > 0 && <>Moved {moveCount}{daysTagged > 1 ? ' · ' : ''}</>}
                {daysTagged > 1 && <>Tagged {daysTagged} days</>}
              </div>
            )}
            {(task.projectName || showPlanned) && (
              <div className="t-list-badges">
                {task.projectName && (
                  <span className="t-badge t-badge-project" title={task.projectName}>{task.projectName}</span>
                )}
                {showPlanned && plannedDay && (
                  <span className="t-badge t-badge-planned" title={`Planned for ${formatShort(plannedDay)}`}>
                    {`Planned for ${formatMonthDay(plannedDay)}`}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
      <td role="cell" className="t-list-cell t-list-cell--status">
        {statusLocked ? (
          <span
            className={`t-badge t-badge-${status} t-badge-derived t-status-btn`}
            title={getDerivedStatusTitle(openChildCount)}
          >
            {statusLabel}
            <span className="sr-only"> (derived from open subtasks)</span>
          </span>
        ) : blocked ? (
          <button
            type="button"
            data-task-status-id={task.id}
            className="t-badge t-badge-blocked t-badge-clickable t-status-btn tap-target"
            aria-label={`Unblock task: ${task.title}`}
            title="Unblock"
            onClick={() => onUnblock?.(task)}
          >
            <BlockIcon size={11} />
            <span>{statusLabel}</span>
          </button>
        ) : (
          <span
            className={`t-badge t-badge-${status} t-badge-clickable t-status-btn tap-target`}
            onClick={() => onStatusCycle(task)}
            role="button"
            tabIndex={0}
            data-task-status-id={task.id}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStatusCycle(task) } }}
            aria-label={nextLabel ? `Status: ${statusLabel}. Click to change to ${nextLabel}.` : `Status: ${statusLabel}. Click to change.`}
          >
            {statusLabel}
          </span>
        )}
      </td>
      <td role="cell" className="t-list-cell t-list-cell--priority">
        <span className={`t-badge t-badge-${priority}`}>{priority}</span>
      </td>
      <td role="cell" className="t-list-cell t-list-cell--due">
        {task.dueDate ? (
          <span
            className={overdue ? 't-overdue' : ''}
            aria-label={overdue ? `Overdue, ${formatDateOnly(task.dueDate)}` : undefined}
          >
            {overdue && <span className="t-overdue-icon" aria-hidden="true">!</span>}
            {formatDateOnly(task.dueDate)}
          </span>
        ) : (
          <span className="t-list-empty">{'—'}</span>
        )}
      </td>
      <td role="cell" className="t-list-cell t-list-cell--actions">
        <div className="t-card-actions">
          {/* Gated by the STORED status; aria-disabled (never `disabled`) keeps it focusable so the reason is readable. */}
          <button
            className={`t-btn-icon${isAddingChild ? ' is-active' : ''} aria-disabled:opacity-50 aria-disabled:cursor-not-allowed! aria-disabled:hover:bg-transparent! aria-disabled:hover:text-(--muted)! aria-disabled:hover:border-(--line)!`}
            aria-label="Add subtask"
            title={addSubtaskDisabled ? COMPLETED_PARENT_ADD_SUBTASK_HINT : 'Add subtask'}
            data-add-child-anchor={`row:${task.id}`}
            aria-disabled={addSubtaskDisabled ? 'true' : undefined}
            aria-describedby={addSubtaskDisabled ? addSubtaskHintId : undefined}
            onClick={() => {
              if (addSubtaskDisabled) return
              onAddChild?.(task)
            }}
          >
            <PlusIcon />
          </button>
          {addSubtaskDisabled && <span id={addSubtaskHintId} className="sr-only">{COMPLETED_PARENT_ADD_SUBTASK_HINT}</span>}
          {blockable && !blocking && (
            <button
              ref={blockBtnRef}
              className="t-btn-icon t-btn-icon--block"
              aria-label={`Block task: ${task.title}`}
              title="Block"
              onClick={() => { setBlockDraft(''); setBlocking(true) }}
            >
              <BlockIcon size={14} />
            </button>
          )}
          <button className="t-btn-icon" aria-label="Task history" title="Task history" onClick={() => onHistory(task)}>
            <ClockIcon />
          </button>
          <button className="t-btn-icon" aria-label={task.title.trim() ? `Edit ${task.title}` : 'Edit task'} title="Edit" data-task-edit-id={task.id} onClick={() => onEdit(task)}>
            <PencilIcon />
          </button>
          {/* aria-disabled (never `disabled`) keeps the button focusable so its reason can be read. The `!`
              variants beat the unlayered tasks.css cursor and hover rules, which Tailwind's layer cannot. */}
          <button
            className="t-btn-icon t-btn-icon--danger t-action-delete aria-disabled:opacity-50 aria-disabled:cursor-not-allowed! aria-disabled:hover:bg-transparent! aria-disabled:hover:text-(--muted)! aria-disabled:hover:border-(--line)!"
            aria-label={`Delete task: ${task.title}`}
            title={deleteBlocked ? deleteHint : 'Delete'}
            data-task-delete-id={task.id}
            aria-disabled={deleteBlocked ? 'true' : undefined}
            aria-describedby={deleteBlocked ? deleteHintId : undefined}
            onClick={() => {
              if (deleteBlocked) return
              onDelete(task)
            }}
          >
            <XIcon />
          </button>
          {deleteBlocked && <span id={deleteHintId} className="sr-only">{deleteHint}</span>}
        </div>
      </td>
    </tr>
    {(blocking || reasonEditing) && (
      <tr role="row" className="t-list-row t-list-row--block-editor">
        <td role="cell" className="t-list-cell" colSpan={5}>
          <BlockReasonInput
            className="t-input t-block-input"
            initialValue={blocking ? blockDraft : (task.blockedReason ?? '')}
            onSubmit={blocking ? submitBlock : submitReason}
            onCancel={(_reason, via) => cancelInput(via, blocking ? 'block' : 'reason')}
          />
        </td>
      </tr>
    )}
    </Fragment>
  )
}
