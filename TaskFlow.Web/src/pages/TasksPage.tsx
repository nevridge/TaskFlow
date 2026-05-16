import { useState } from 'react'
import { useTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from '@/hooks/useTasks'
import { TaskCard } from '@/components/TaskCard'
import { TaskForm } from '@/components/TaskForm'
import type { TaskItemResponseDto, CreateTaskItemDto } from '@/api/client/types.gen'
import '@/tasks.css'

type StatusFilter = 'all' | 'draft' | 'todo' | 'completed'
type PriorityFilter = 'all' | 'low' | 'medium' | 'high'
type SortKey = 'title' | 'dueDate' | 'priority'

const priorityOrder = { high: 0, medium: 1, low: 2 }

export function TasksPage() {
  const { data, isLoading, error } = useTasksQuery()
  const createMutation = useCreateTaskMutation()
  const updateMutation = useUpdateTaskMutation()
  const deleteMutation = useDeleteTaskMutation()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [editingTask, setEditingTask] = useState<TaskItemResponseDto | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const tasks: TaskItemResponseDto[] = (data?.data as TaskItemResponseDto[] | undefined) ?? []

  const filtered = tasks
    .filter(t => statusFilter === 'all' || t.status?.toLowerCase() === statusFilter)
    .filter(t => priorityFilter === 'all' || t.priority?.toLowerCase() === priorityFilter)
    .sort((a, b) => {
      if (sortKey === 'title') return a.title.localeCompare(b.title)
      if (sortKey === 'dueDate') return (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
      if (sortKey === 'priority') {
        const pa = priorityOrder[(a.priority ?? '').toLowerCase() as keyof typeof priorityOrder] ?? 2
        const pb = priorityOrder[(b.priority ?? '').toLowerCase() as keyof typeof priorityOrder] ?? 2
        return pa - pb
      }
      return 0
    })

  function handleCreate(data: CreateTaskItemDto) {
    createMutation.mutate(data, { onSuccess: () => setShowCreate(false) })
  }

  function handleUpdate(data: CreateTaskItemDto) {
    if (!editingTask?.id) return
    updateMutation.mutate(
      { id: Number(editingTask.id), data },
      { onSuccess: () => setEditingTask(null) }
    )
  }

  function handleDelete(task: TaskItemResponseDto) {
    if (window.confirm(`Delete "${task.title}"?`)) {
      deleteMutation.mutate(Number(task.id))
    }
  }

  if (isLoading) return <div className="tasks-page"><div className="t-shell"><p className="t-loading">Loading tasks…</p></div></div>
  if (error) return <div className="tasks-page"><div className="t-shell"><p className="t-error">Failed to load tasks.</p></div></div>

  return (
    <div className="tasks-page">
      <div className="t-shell">
        <div className="t-page-hdr">
          <h1 className="t-page-title">Tasks</h1>
          <button className="t-btn-primary" onClick={() => setShowCreate(true)}>New Task</button>
        </div>

        {(showCreate || editingTask) && (
          <div className="t-panel">
            <h2 className="t-panel-title">{editingTask ? 'Edit Task' : 'New Task'}</h2>
            <TaskForm
              task={editingTask ?? undefined}
              onSubmit={editingTask ? handleUpdate : handleCreate}
              onCancel={() => { setShowCreate(false); setEditingTask(null) }}
            />
          </div>
        )}

        <div className="t-filter-row">
          <label htmlFor="status-filter" className="t-filter-label">Status</label>
          <select
            id="status-filter"
            className="t-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="todo">Todo</option>
            <option value="completed">Completed</option>
          </select>

          <label htmlFor="priority-filter" className="t-filter-label">Priority</label>
          <select
            id="priority-filter"
            className="t-select"
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value as PriorityFilter)}
          >
            <option value="all">All</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <label htmlFor="sort-key" className="t-filter-label">Sort</label>
          <select
            id="sort-key"
            className="t-select"
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
          >
            <option value="title">Title</option>
            <option value="dueDate">Due Date</option>
            <option value="priority">Priority</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <p className="t-empty">No tasks match your filters.</p>
        ) : (
          <div className="t-card-grid">
            {filtered.map(task => (
              <TaskCard
                key={String(task.id)}
                task={task}
                onEdit={setEditingTask}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
