import { Fragment, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate } from '@/lib/utils'
import { todayISO } from '@/lib/journal-utils'
import { BlockIcon, BlockReasonInput, BlockedReasonText } from '@/components/BlockControls'
import { canBlock, getStatusLabel, isBlocked as isBlockedStatus, nextCycleStatus } from '@/lib/task-status'
import type { TaskItemResponseDto } from '@/api/client/types.gen'

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
  hasChildren?: boolean
  isExpanded?: boolean
  childProgress?: string | null
  onToggleChildren?: (task: TaskRowModel) => void
  onAddChild?: (task: TaskRowModel) => void
  isAddingChild?: boolean
  onEdit: (task: TaskRowModel) => void
  onHistory: (task: TaskRowModel) => void
  onDelete: (task: TaskRowModel) => void
  onStatusCycle: (task: TaskRowModel) => void
  /** Block with an optional reason. Must reject on failure so the reason input can re-open with the typed text. */
  onBlock?: (task: TaskRowModel, reason: string) => Promise<void>
  onUnblock?: (task: TaskRowModel) => void
  /** Save a new reason for a Blocked task (""clears it). Must reject on failure. */
  onEditBlockedReason?: (task: TaskRowModel, reason: string) => Promise<void>
}

function isOverdue(dueDate: string | null | undefined, status: string | undefined): boolean {
  if (!dueDate) return false
  if ((status ?? '').toLowerCase() === 'completed') return false
  return dueDate.slice(0, 10) < todayISO()
}

function isDueToday(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false
  return dueDate.slice(0, 10) === todayISO()
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
  hasChildren = false,
  isExpanded = false,
  childProgress,
  onToggleChildren,
  onAddChild,
  isAddingChild = false,
  onEdit,
  onHistory,
  onDelete,
  onStatusCycle,
  onBlock,
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
  const blocked = isBlockedStatus(task.status)
  const blockable = canBlock(task.status) && !!onBlock
  // childTaskCount already excludes subtasks whose delete is pending.
  const childCount = Number(task.childTaskCount ?? 0)
  const deleteBlocked = childCount > 0
  const deleteHint = `Delete subtasks first (${childCount})`
  const deleteHintId = `del-hint-${task.id}`

  const status = (task.status ?? 'draft').toLowerCase()
  const statusLabel = getStatusLabel(task.status ?? 'draft')
  const nextRequest = nextCycleStatus(task.status)
  const nextLabel = nextRequest ? getStatusLabel(nextRequest) : null
  const priority = (task.priority ?? 'low').toLowerCase()
  const overdue = isOverdue(task.dueDate, task.status)
  const moveCount = task.moveCount ?? 0
  const daysTagged = task.daysTagged ?? 0
  const isCompleted = status === 'completed'
  const highDeferral = moveCount >= 3
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
          {hasChildren ? (
            <button
              className="t-tree-toggle"
              onClick={() => onToggleChildren?.(task)}
              aria-label={isExpanded ? 'Hide subtasks' : 'Show subtasks'}
              title={isExpanded ? 'Hide subtasks' : 'Show subtasks'}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="t-tree-spacer" aria-hidden="true" />
          )}
          <div>
            <div className="t-title-line">
              {task.id !== undefined && task.id !== null && (
                <span className="t-task-id" aria-label={`Task ${task.id}`} role="img">#{task.id}</span>
              )}
              <Link ref={titleLinkRef} to={`/tasks/${task.id}`} className={`t-task-link${boldTitle ? ' t-title-bold' : ''}`}>
                {task.title}
              </Link>
            </div>
            {childProgress && <div className="t-deferral-line">{childProgress}</div>}
            {blocked && !reasonEditing && (
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
            {task.projectName && (
              <div>
                <span className="t-badge t-badge-project" title={task.projectName}>{task.projectName}</span>
              </div>
            )}
          </div>
        </div>
      </td>
      <td role="cell" className="t-list-cell t-list-cell--status">
        {blocked ? (
          <button
            type="button"
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
            aria-label={overdue ? `Overdue, ${formatDate(task.dueDate)}` : undefined}
          >
            {overdue && <span className="t-overdue-icon" aria-hidden="true">!</span>}
            {formatDate(task.dueDate)}
          </span>
        ) : (
          <span className="t-list-empty">{'—'}</span>
        )}
      </td>
      <td role="cell" className="t-list-cell t-list-cell--actions">
        <div className="t-card-actions">
          <button className={`t-btn-icon${isAddingChild ? ' is-active' : ''}`} aria-label="Add subtask" title="Add subtask" onClick={() => onAddChild?.(task)}>
            <PlusIcon />
          </button>
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
          <button className="t-btn-icon" aria-label="Edit" title="Edit" data-task-edit-id={task.id} onClick={() => onEdit(task)}>
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
