import { Link } from 'react-router-dom'
import { formatDate } from '@/lib/utils'
import type { TaskItemResponseDto } from '@/api/client/types.gen'

interface Props {
  task: TaskItemResponseDto
  onEdit: (task: TaskItemResponseDto) => void
  onDelete: (task: TaskItemResponseDto) => void
}

export function TaskCard({ task, onEdit, onDelete }: Props) {
  const status = String(task.status ?? 'draft').toLowerCase()
  const priority = String(task.priority ?? 'low').toLowerCase()

  return (
    <div className="t-card">
      <div className="t-card-row">
        <Link to={`/tasks/${task.id}`} className="t-task-link">
          {task.title}
        </Link>
        <div className="t-card-actions">
          <button className="t-btn" aria-label="Edit" onClick={() => onEdit(task)}>Edit</button>
          <button className="t-btn-danger" aria-label="Delete" onClick={() => onDelete(task)}>Delete</button>
        </div>
      </div>
      <div className="t-badges">
        <span className={`t-badge t-badge-${status}`}>{status}</span>
        <span className={`t-badge t-badge-${priority}`}>{priority}</span>
      </div>
      {task.dueDate && (
        <span className="t-card-meta">Due {formatDate(task.dueDate)}</span>
      )}
    </div>
  )
}
