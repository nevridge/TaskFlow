import { Link } from 'react-router-dom'
import { formatDate } from '@/lib/utils'
import { formatShort, todayISO } from '@/lib/journal-utils'
import type { TaskItemResponseDto } from '@/api/client/types.gen'

type TaskRowModel = TaskItemResponseDto & {
  currentJournalDate?: string | null
  moveCount?: number
  daysTagged?: number
}

interface Props {
  task: TaskRowModel
  isOnTodayJournal: boolean
  onEdit: (task: TaskRowModel) => void
  onHistory: (task: TaskRowModel) => void
  onDelete: (task: TaskRowModel) => void
}

function isOverdue(dueDate: string | null | undefined, status: string | undefined): boolean {
  if (!dueDate) return false
  if ((status ?? '').toLowerCase() === 'completed') return false
  // Compare ISO date strings (YYYY-MM-DD) to avoid timezone offset issues with UTC-stored dates
  return dueDate.slice(0, 10) < todayISO()
}

export function TaskListRow({ task, isOnTodayJournal, onEdit, onHistory, onDelete }: Props) {
  const status = (task.status ?? 'draft').toLowerCase()
  const priority = (task.priority ?? 'low').toLowerCase()
  const overdue = isOverdue(task.dueDate, task.status)
  const assignedDate = task.currentJournalDate ?? null
  const isScheduledFuture = !!assignedDate && assignedDate > todayISO()
  const moveCount = task.moveCount ?? 0
  const daysTagged = task.daysTagged ?? 0

  return (
    <tr className="t-list-row">
      <td className="t-list-cell t-list-cell--title">
        <Link to={`/tasks/${task.id}`} className="t-task-link">
          {task.title}
        </Link>
      </td>
      <td className="t-list-cell">
        <span className={`t-badge t-badge-${status}`}>{status}</span>
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
          <span className="t-list-empty">—</span>
        )}
      </td>
      <td className="t-list-cell t-list-cell--journal">
        {assignedDate ? (
          <div>
            <div>{formatShort(assignedDate)}</div>
            {isScheduledFuture && <span className="t-badge t-badge-scheduled">scheduled for {formatShort(assignedDate)}</span>}
          </div>
        ) : (
          <span className="t-list-empty">—</span>
        )}
      </td>
      <td className="t-list-cell t-list-cell--movement">
        <span className="t-movement-cell">Tagged {daysTagged}d · Moved {moveCount}</span>
      </td>
      <td className="t-list-cell t-list-cell--journal">
        {isOnTodayJournal && (
          <span className="t-journal-dot" title="On today's journal" role="img" aria-label="On today's journal">
            📔
          </span>
        )}
      </td>
      <td className="t-list-cell t-list-cell--actions">
        <div className="t-card-actions">
          <button className="t-btn" aria-label="History" onClick={() => onHistory(task)}>History</button>
          <button className="t-btn" aria-label="Edit" onClick={() => onEdit(task)}>Edit</button>
          <button className="t-btn-danger" aria-label="Delete" onClick={() => onDelete(task)}>Delete</button>
        </div>
      </td>
    </tr>
  )
}