import { type FormEvent, useState } from 'react'
import type { TaskItemResponseDto, CreateTaskItemDto } from '@/api/client/types.gen'

interface Props {
  task?: TaskItemResponseDto
  onSubmit: (data: CreateTaskItemDto) => void
  onCancel: () => void
}

export function TaskForm({ task, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<string>((task?.status ?? 'draft').toLowerCase())
  const [priority, setPriority] = useState<string>((task?.priority ?? 'low').toLowerCase())
  const [dueDate, setDueDate] = useState(task?.dueDate ? task.dueDate.split('T')[0] : '')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit({
      title,
      description: description || null,
      status: status as 'draft' | 'todo' | 'completed',
      priority: priority as 'low' | 'medium' | 'high',
      // dueDate is always YYYY-MM-DD from <input type="date">; append UTC midnight to avoid timezone drift
      dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="t-form">
      <div className="t-field">
        <label htmlFor="title" className="t-label">Title</label>
        <input id="title" className="t-input" value={title} onChange={e => setTitle(e.target.value)} required />
      </div>
      <div className="t-field">
        <label htmlFor="description" className="t-label">Description</label>
        <textarea
          id="description"
          className="t-input"
          value={description ?? ''}
          onChange={e => setDescription(e.target.value)}
          rows={3}
        />
      </div>
      <div className="t-form-row">
        <div className="t-field">
          <label htmlFor="status" className="t-label">Status</label>
          <select id="status" className="t-input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="todo">Todo</option>
            <option value="completed">Completed</option>
          </select>
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
      <div className="t-field">
        <label htmlFor="dueDate" className="t-label">Due Date</label>
        <input id="dueDate" type="date" className="t-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </div>
      <div className="t-form-actions">
        <button type="button" className="t-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="t-btn-primary">Save</button>
      </div>
    </form>
  )
}
