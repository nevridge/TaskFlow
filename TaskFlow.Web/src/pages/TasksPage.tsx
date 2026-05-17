import { useEffect, useRef, useState } from 'react'
import { useTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from '@/hooks/useTasks'
import { useJournalEntries } from '@/hooks/useJournal'
import { usePrefs } from '@/context/usePrefs'
import { TaskListRow } from '@/components/TaskListRow'
import { TaskHistoryPanel } from '@/components/TaskHistoryPanel'
import { TaskForm, type TaskFormPayload } from '@/components/TaskForm'
import type { TaskItemResponseDto, CreateTaskItemDto, UpdateTaskItemDto } from '@/api/client/types.gen'
import type { TaskSortKey } from '@/lib/prefs'
import type { JournalEntryResponseDto } from '@/api/journal'
import { todayISO } from '@/lib/journal-utils'
import '@/tasks.css'

type StatusFilter = 'all' | 'draft' | 'todo' | 'completed'
type PriorityFilter = 'all' | 'low' | 'medium' | 'high'
type ViewFilter = 'all' | 'activeToday' | 'scheduledFuture' | 'completedHistory'

const priorityOrder = { high: 0, medium: 1, low: 2 }

interface ColHeader {
  key: TaskSortKey
  label: string
}

type TaskListModel = TaskItemResponseDto & {
  currentJournalDate?: string | null
  moveCount?: number
  daysTagged?: number
}

const COLUMNS: ColHeader[] = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'dueDate', label: 'Due Date' },
]

export function TasksPage() {
  const { data, isLoading, error } = useTasksQuery()
  const { data: journalData } = useJournalEntries()
  const createMutation = useCreateTaskMutation()
  const updateMutation = useUpdateTaskMutation()
  const deleteMutation = useDeleteTaskMutation()
  const { taskSortKey, setTaskSortKey, taskSortDir, setTaskSortDir } = usePrefs()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [editingTask, setEditingTask] = useState<TaskListModel | null>(null)
  const [historyTask, setHistoryTask] = useState<TaskListModel | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const historyCloseRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!historyTask) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    historyCloseRef.current?.focus()

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHistoryTask(null)
      }
    }

    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = previousOverflow
    }
  }, [historyTask])

  const tasks: TaskListModel[] = (data?.data as TaskListModel[] | undefined) ?? []

  const todayEntry = ((journalData?.data as JournalEntryResponseDto[] | undefined) ?? [])
    .find(e => e.date === todayISO())
  const todayTaskIds = new Set<number>(todayEntry?.todoTaskItemIds ?? [])

  function handleSortClick(key: TaskSortKey) {
    if (key === taskSortKey) {
      setTaskSortDir(taskSortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setTaskSortKey(key)
      setTaskSortDir('asc')
    }
  }

  const filtered = tasks
    .filter(t => matchesViewFilter(t, viewFilter))
    .filter(t => statusFilter === 'all' || t.status?.toLowerCase() === statusFilter)
    .filter(t => priorityFilter === 'all' || t.priority?.toLowerCase() === priorityFilter)
    .sort((a, b) => {
      let cmp = 0
      if (taskSortKey === 'title') cmp = a.title.localeCompare(b.title)
      else if (taskSortKey === 'dueDate') cmp = (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
      else if (taskSortKey === 'status') cmp = (a.status ?? '').localeCompare(b.status ?? '')
      else if (taskSortKey === 'priority') {
        const pa = priorityOrder[(a.priority ?? '').toLowerCase() as keyof typeof priorityOrder] ?? 2
        const pb = priorityOrder[(b.priority ?? '').toLowerCase() as keyof typeof priorityOrder] ?? 2
        cmp = pa - pb
      }
      return taskSortDir === 'asc' ? cmp : -cmp
    })

  function handleCreate(data: TaskFormPayload) {
    setMutationError(null)
    createMutation.mutate(data as CreateTaskItemDto, {
      onSuccess: () => setShowCreate(false),
      onError: err => setMutationError(getTaskMutationErrorMessage(err)),
    })
  }

  function handleUpdate(data: TaskFormPayload) {
    if (!editingTask?.id) return
    setMutationError(null)
    updateMutation.mutate(
      { id: Number(editingTask.id), data: data as UpdateTaskItemDto },
      {
        onSuccess: () => setEditingTask(null),
        onError: err => setMutationError(getTaskMutationErrorMessage(err)),
      }
    )
  }

  const parentOptions = tasks
    .filter(t => !editingTask || Number(t.id) !== Number(editingTask.id))
    .map(t => ({ id: Number(t.id), title: t.title }))

  function handleDelete(task: TaskListModel) {
    if (window.confirm(`Delete "${task.title}"?`)) {
      deleteMutation.mutate(Number(task.id))
    }
  }

  function sortIcon(key: TaskSortKey): string {
    if (key !== taskSortKey) return ''
    return taskSortDir === 'asc' ? ' ↑' : ' ↓'
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
            {mutationError && <p className="t-inline-error">{mutationError}</p>}
            <TaskForm
              task={editingTask ?? undefined}
              availableParents={parentOptions}
              onSubmit={editingTask ? handleUpdate : handleCreate}
              onCancel={() => { setShowCreate(false); setEditingTask(null); setMutationError(null) }}
            />
          </div>
        )}

        {historyTask && (
          <>
            <div className="t-modal-backdrop" onClick={() => setHistoryTask(null)} aria-hidden="true" />
            <div className="t-modal" role="dialog" aria-modal="true" aria-labelledby="task-history-title">
              <div className="t-modal-header">
                <div>
                  <h2 id="task-history-title" className="t-panel-title t-panel-title--tight">Task history</h2>
                  <div className="t-modal-subtitle">{historyTask.title}</div>
                </div>
                <button ref={historyCloseRef} className="t-btn" onClick={() => setHistoryTask(null)}>Close</button>
              </div>
              <TaskHistoryPanel taskId={Number(historyTask.id)} />
            </div>
          </>
        )}

        <div className="t-filter-row">
          <div className="t-chip-group" aria-label="Task view filters">
            <button type="button" className={`t-chip${viewFilter === 'all' ? ' is-active' : ''}`} onClick={() => setViewFilter('all')}>All</button>
            <button type="button" className={`t-chip${viewFilter === 'activeToday' ? ' is-active' : ''}`} onClick={() => setViewFilter('activeToday')}>Active today</button>
            <button type="button" className={`t-chip${viewFilter === 'scheduledFuture' ? ' is-active' : ''}`} onClick={() => setViewFilter('scheduledFuture')}>Scheduled future</button>
            <button type="button" className={`t-chip${viewFilter === 'completedHistory' ? ' is-active' : ''}`} onClick={() => setViewFilter('completedHistory')}>Completed history</button>
          </div>

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

          <span className="t-filter-count">{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {filtered.length === 0 ? (
          <p className="t-empty">No tasks match your filters.</p>
        ) : (
          <div className="t-list-wrap">
            <table className="t-list-table">
              <thead>
                <tr className="t-list-head-row">
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      className={`t-list-th${col.key === taskSortKey ? ' t-col-sort--active' : ''}`}
                      aria-sort={col.key === taskSortKey ? (taskSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button
                        type="button"
                        className="t-col-sort-btn"
                        onClick={() => handleSortClick(col.key)}
                      >
                        {col.label}{sortIcon(col.key)}
                      </button>
                    </th>
                  ))}
                  <th className="t-list-th">Assigned Day</th>
                  <th className="t-list-th t-list-th--movement">Movement</th>
                  <th className="t-list-th t-list-th--journal" title="On today's journal">Journal</th>
                  <th className="t-list-th t-list-th--actions" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(task => (
                  <TaskListRow
                    key={String(task.id)}
                    task={task}
                    isOnTodayJournal={todayTaskIds.has(Number(task.id))}
                    onEdit={setEditingTask}
                    onHistory={setHistoryTask}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function getTaskMutationErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED') {
    return 'Completed tasks assigned to past days cannot be reopened.'
  }

  if (code === 'TASK_PARENT_INCOMPLETE_CHILDREN') {
    return 'Parent tasks cannot be completed while child tasks are still open.'
  }

  if (code === 'TASK_PARENT_SELF_NOT_ALLOWED') {
    return 'A task cannot be set as its own parent.'
  }

  if (code === 'TASK_PARENT_NOT_FOUND') {
    return 'The selected parent task was not found.'
  }

  if (code === 'TASK_CREATION_PAST_DAY_NOT_ALLOWED') {
    return 'You cannot create new tasks on a past journal day.'
  }

  return 'Unable to save task changes. Please try again.'
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'string' ? maybeCode : null
}

function matchesViewFilter(task: TaskListModel, viewFilter: ViewFilter): boolean {
  const assignedDate = task.currentJournalDate ?? null
  const status = (task.status ?? '').toLowerCase()
  const isCompleted = status === 'completed' || !!task.isComplete

  switch (viewFilter) {
    case 'activeToday':
      return assignedDate === todayISO() && !isCompleted
    case 'scheduledFuture':
      return assignedDate != null && assignedDate > todayISO()
    case 'completedHistory':
      return isCompleted && assignedDate != null && assignedDate < todayISO()
    default:
      return true
  }
}
