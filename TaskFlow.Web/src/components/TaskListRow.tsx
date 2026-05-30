import { Link } from 'react-router-dom'
import { formatDate } from '@/lib/utils'
import { todayISO } from '@/lib/journal-utils'
import type { TaskItemResponseDto } from '@/api/client/types.gen'

type TaskRowModel = TaskItemResponseDto & {
  currentJournalDate?: string | null
  currentJournalEntryId?: number | null
  moveCount?: number
  daysTagged?: number
  parentTaskItemId?: number | null
  childCount?: number
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
}: Props) {
  const status = (task.status ?? 'draft').toLowerCase()
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
  ].filter(Boolean).join(' ')

  return (
    <tr className={rowClasses}>
      <td className="t-list-cell t-list-cell--title">
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
            <Link to={`/tasks/${task.id}`} className={`t-task-link${boldTitle ? ' t-title-bold' : ''}`}>
              {task.title}
            </Link>
            {childProgress && <div className="t-deferral-line">{childProgress}</div>}
            {showDeferral && (
              <div className="t-deferral-line">
                {highDeferral && <span className="t-deferral-badge">{'↻'} {moveCount}</span>}
                {highDeferral && daysTagged > 1 && ' · '}
                {!highDeferral && moveCount > 0 && <>Moved {moveCount}{daysTagged > 1 ? ' · ' : ''}</>}
                {daysTagged > 1 && <>Tagged {daysTagged} days</>}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="t-list-cell">
        <span
          className={`t-badge t-badge-${status} t-badge-clickable`}
          onClick={() => onStatusCycle(task)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStatusCycle(task) } }}
          aria-label={`Status: ${status}. Click to change.`}
        >
          {status}
        </span>
      </td>
      <td className="t-list-cell">
        <span className={`t-badge t-badge-${priority}`}>{priority}</span>
      </td>
      <td className="t-list-cell t-list-cell--due">
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
      <td className="t-list-cell t-list-cell--actions">
        <div className="t-card-actions">
          <button className={`t-btn-icon${isAddingChild ? ' is-active' : ''}`} aria-label="Add subtask" title="Add subtask" onClick={() => onAddChild?.(task)}>
            <PlusIcon />
          </button>
          <button className="t-btn-icon" aria-label="Task history" title="Task history" onClick={() => onHistory(task)}>
            <ClockIcon />
          </button>
          <button className="t-btn-icon" aria-label="Edit" title="Edit" onClick={() => onEdit(task)}>
            <PencilIcon />
          </button>
          <button className="t-btn-icon t-btn-icon--danger" aria-label="Delete" title="Delete" onClick={() => onDelete(task)}>
            <XIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}
