import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  useTasksQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  type CreateTaskPayload,
  type TaskItemViewModel,
  type UpdateTaskPayload,
} from '@/hooks/useTasks'
import { usePrefs } from '@/context/usePrefs'
import { TaskListRow } from '@/components/TaskListRow'
import { TaskHistoryPanel } from '@/components/TaskHistoryPanel'
import { TaskForm, type TaskFormPayload } from '@/components/TaskForm'
import type { TaskSortKey } from '@/lib/prefs'
import { todayISO } from '@/lib/journal-utils'
import '@/tasks.css'

type StatusFilter = 'all' | 'draft' | 'todo' | 'completed'
type ViewFilter = 'all' | 'activeToday' | 'scheduledFuture' | 'completedHistory'

type TaskListModel = TaskItemViewModel

type PriorityGroup = {
  key: string
  label: string
  cssModifier: string
  tasks: Array<{ task: TaskListModel; depth: number }>
}

const STATUS_CYCLE: Record<string, string> = {
  draft: 'todo',
  todo: 'completed',
  completed: 'draft',
}

const COLUMNS: Array<{ key: TaskSortKey; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'dueDate', label: 'Due Date' },
]

export function TasksPage() {
  const { data, isLoading, error } = useTasksQuery()
  const createMutation = useCreateTaskMutation()
  const updateMutation = useUpdateTaskMutation()
  const deleteMutation = useDeleteTaskMutation()
  const {
    taskSortKey,
    setTaskSortKey,
    taskSortDir,
    setTaskSortDir,
    autoCompleteParentWhenChildrenDone,
  } = usePrefs()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [editingTask, setEditingTask] = useState<TaskListModel | null>(null)
  const [historyTask, setHistoryTask] = useState<TaskListModel | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [expandedParentIds, setExpandedParentIds] = useState<Set<number>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [addingChildForTaskId, setAddingChildForTaskId] = useState<number | null>(null)
  const [childDraftTitle, setChildDraftTitle] = useState('')
  const historyCloseRef = useRef<HTMLButtonElement | null>(null)
  const knownParentIdsRef = useRef<Set<number>>(new Set())

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 200)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    if (!historyTask) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    historyCloseRef.current?.focus()
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryTask(null)
    }
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = previousOverflow
    }
  }, [historyTask])

  const tasks: TaskListModel[] = useMemo(
    () => (data?.data as TaskListModel[] | undefined) ?? [],
    [data],
  )

  function handleSortClick(key: TaskSortKey) {
    if (key === taskSortKey) {
      setTaskSortDir(taskSortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setTaskSortKey(key)
      setTaskSortDir('asc')
    }
  }

  function sortIcon(key: TaskSortKey): string {
    if (key !== taskSortKey) return ''
    return taskSortDir === 'asc' ? ' ↑' : ' ↓'
  }

  // Apply filters: view filter, status filter, search
  const filtered = useMemo(() => {
    return tasks
      .filter(t => matchesViewFilter(t, viewFilter))
      .filter(t => statusFilter === 'all' || (t.status ?? '').toLowerCase() === statusFilter)
      .filter(t => !debouncedSearch || t.title.toLowerCase().includes(debouncedSearch.toLowerCase()))
  }, [tasks, viewFilter, statusFilter, debouncedSearch])

  // Sort comparator for within-group sorting
  function compareWithinGroup(a: TaskListModel, b: TaskListModel): number {
    // Default: due date ascending (overdue first, then soonest, no-date last)
    const aDue = a.dueDate ?? ''
    const bDue = b.dueDate ?? ''
    if (!aDue && bDue) return 1
    if (aDue && !bDue) return -1
    let cmp = aDue.localeCompare(bDue)

    // If user has set a custom sort, use it as secondary
    if (taskSortKey === 'title') cmp = a.title.localeCompare(b.title)
    else if (taskSortKey === 'status') cmp = (a.status ?? '').localeCompare(b.status ?? '')
    else if (taskSortKey === 'dueDate') {
      if (!aDue && bDue) return 1
      if (aDue && !bDue) return -1
      cmp = aDue.localeCompare(bDue)
    }

    return taskSortDir === 'asc' ? cmp : -cmp
  }

  // Build child lookup maps
  const filteredById = useMemo(
    () => new Map(filtered.map(task => [Number(task.id), task])),
    [filtered],
  )

  const childStatsByParentId = useMemo(() => {
    const stats = new Map<number, { done: number; total: number }>()
    tasks.forEach(task => {
      const parentId = task.parentTaskItemId ? Number(task.parentTaskItemId) : null
      if (!parentId) return
      const prev = stats.get(parentId) ?? { done: 0, total: 0 }
      const isDone = (task.status ?? '').toLowerCase() === 'completed' || !!task.isComplete
      stats.set(parentId, { total: prev.total + 1, done: prev.done + (isDone ? 1 : 0) })
    })
    return stats
  }, [tasks])

  const childrenByParentId = useMemo(() => {
    const groups = new Map<number, TaskListModel[]>()
    filtered.forEach(task => {
      const parentId = task.parentTaskItemId ? Number(task.parentTaskItemId) : null
      if (!parentId || !filteredById.has(parentId)) return
      const items = groups.get(parentId) ?? []
      items.push(task)
      groups.set(parentId, items)
    })
    return groups
  }, [filtered, filteredById])

  const parentIds = useMemo(
    () => Array.from(childrenByParentId.keys()),
    [childrenByParentId],
  )

  useEffect(() => {
    setExpandedParentIds(prev => {
      let changed = false
      const next = new Set(prev)
      const known = knownParentIdsRef.current
      parentIds.forEach(id => {
        if (!known.has(id)) { next.add(id); known.add(id); changed = true }
      })
      for (const knownId of Array.from(known)) {
        if (!parentIds.includes(knownId)) known.delete(knownId)
      }
      return changed ? next : prev
    })
  }, [parentIds])

  // Build priority groups with hierarchical rows
  const priorityGroups: PriorityGroup[] = useMemo(() => {
    const groupDefs = [
      { key: 'high', label: 'High Priority', cssModifier: 'high' },
      { key: 'medium', label: 'Medium Priority', cssModifier: 'medium' },
      { key: 'low', label: 'Low Priority', cssModifier: 'low' },
      { key: 'draft', label: 'Draft', cssModifier: 'draft' },
    ]

    return groupDefs.map(def => {
      const groupTasks = filtered.filter(t => {
        const status = (t.status ?? '').toLowerCase()
        if (def.key === 'draft') return status === 'draft'
        return status !== 'draft' && (t.priority ?? 'low').toLowerCase() === def.key
      })

      const sorted = [...groupTasks].sort(compareWithinGroup)
      const rootTasks = sorted.filter(task => {
        const parentId = task.parentTaskItemId ? Number(task.parentTaskItemId) : null
        return !parentId || !filteredById.has(parentId)
      })

      const rows: Array<{ task: TaskListModel; depth: number }> = []
      rootTasks.forEach(parent => {
        rows.push({ task: parent, depth: 0 })
        const parentId = Number(parent.id)
        const children = childrenByParentId.get(parentId) ?? []
        if (children.length > 0 && expandedParentIds.has(parentId)) {
          children.forEach(child => rows.push({ task: child, depth: 1 }))
        }
      })

      return { ...def, tasks: rows }
    }).filter(g => g.tasks.length > 0)
  }, [filtered, filteredById, childrenByParentId, expandedParentIds, taskSortKey, taskSortDir])

  // Handlers
  function handleCreate(formData: TaskFormPayload) {
    setMutationError(null)
    createMutation.mutate(formData as CreateTaskPayload, {
      onSuccess: () => setShowCreate(false),
      onError: err => setMutationError(getTaskMutationErrorMessage(err)),
    })
  }

  function handleUpdate(formData: TaskFormPayload) {
    if (!editingTask?.id) return
    setMutationError(null)
    updateMutation.mutate(
      { id: Number(editingTask.id), data: { ...(formData as UpdateTaskPayload), autoCompleteParentWhenChildrenDone } as UpdateTaskPayload },
      { onSuccess: () => setEditingTask(null), onError: err => setMutationError(getTaskMutationErrorMessage(err)) }
    )
  }

  function handleStatusCycle(task: TaskListModel) {
    const currentStatus = (task.status ?? 'draft').toLowerCase()
    const nextStatus = STATUS_CYCLE[currentStatus] ?? 'draft'
    setMutationError(null)
    updateMutation.mutate(
      {
        id: Number(task.id),
        data: {
          title: task.title,
          description: task.description,
          status: nextStatus as 'draft' | 'todo' | 'completed',
          isComplete: nextStatus === 'completed',
          priority: task.priority as 'low' | 'medium' | 'high' | undefined,
          dueDate: task.dueDate,
          parentTaskItemId: task.parentTaskItemId,
          autoCompleteParentWhenChildrenDone,
        } as UpdateTaskPayload,
      },
      { onError: err => setMutationError(getTaskMutationErrorMessage(err)) }
    )
  }

  const parentOptions = tasks
    .filter(t => !editingTask || Number(t.id) !== Number(editingTask.id))
    .map(t => ({ id: Number(t.id), title: t.title }))

  function handleDelete(task: TaskListModel) {
    if (window.confirm(`Delete "${task.title}"?`)) {
      setMutationError(null)
      deleteMutation.mutate(Number(task.id), {
        onError: err => setMutationError(getTaskMutationErrorMessage(err)),
      })
    }
  }

  function toggleChildren(task: TaskListModel) {
    const parentId = Number(task.id)
    setExpandedParentIds(prev => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  function toggleGroup(groupKey: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  function beginAddChild(task: TaskListModel) {
    setMutationError(null)
    setAddingChildForTaskId(Number(task.id))
    setChildDraftTitle('')
    setExpandedParentIds(prev => { const next = new Set(prev); next.add(Number(task.id)); return next })
  }

  function submitAddChild() {
    const parentId = addingChildForTaskId
    const title = childDraftTitle.trim()
    if (!parentId || !title) return
    setMutationError(null)
    createMutation.mutate(
      { title, status: 'todo', parentTaskItemId: parentId } as CreateTaskPayload,
      {
        onSuccess: () => { setAddingChildForTaskId(null); setChildDraftTitle('') },
        onError: err => setMutationError(getTaskMutationErrorMessage(err)),
      },
    )
  }

  const totalFiltered = priorityGroups.reduce((sum, g) => sum + g.tasks.length, 0)

  if (isLoading) return <div className="tasks-page"><div className="t-shell"><p className="t-loading">Loading tasks...</p></div></div>
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
          <div className="t-search-wrap">
            <input
              type="text"
              className="t-search-input"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="t-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">{'×'}</button>
            )}
          </div>
          <div className="t-chip-group" aria-label="Task view filters">
            <button type="button" className={`t-chip${viewFilter === 'all' ? ' is-active' : ''}`} onClick={() => setViewFilter('all')}>All</button>
            <button type="button" className={`t-chip${viewFilter === 'activeToday' ? ' is-active' : ''}`} onClick={() => setViewFilter('activeToday')}>Active today</button>
            <button type="button" className={`t-chip${viewFilter === 'scheduledFuture' ? ' is-active' : ''}`} onClick={() => setViewFilter('scheduledFuture')}>Scheduled future</button>
            <button type="button" className={`t-chip${viewFilter === 'completedHistory' ? ' is-active' : ''}`} onClick={() => setViewFilter('completedHistory')}>Completed history</button>
          </div>
          <span className="t-filter-label">Status</span>
          <select id="status-filter" className="t-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="todo">Todo</option>
            <option value="completed">Completed</option>
          </select>
          <span className="t-filter-count">{totalFiltered} task{totalFiltered !== 1 ? 's' : ''}</span>
        </div>

        {mutationError && !showCreate && !editingTask && <p className="t-inline-error">{mutationError}</p>}

        {totalFiltered === 0 ? (
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
                      <button type="button" className="t-col-sort-btn" onClick={() => handleSortClick(col.key)}>
                        {col.label}{sortIcon(col.key)}
                      </button>
                    </th>
                  ))}
                  <th className="t-list-th t-list-th--actions" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {priorityGroups.map(group => {
                  const isCollapsed = collapsedGroups.has(group.key)
                  return (
                    <Fragment key={group.key}>
                      <tr className={`t-group-header t-group-header--${group.cssModifier}`}>
                        <td colSpan={5}>
                          <button type="button" className="t-group-toggle" onClick={() => toggleGroup(group.key)}>
                            <span className={`t-group-chevron${isCollapsed ? ' t-group-chevron--collapsed' : ''}`}>{'▾'}</span>
                            {group.label}
                            <span className="t-group-count">{'·'} {group.tasks.length} task{group.tasks.length !== 1 ? 's' : ''}</span>
                          </button>
                        </td>
                      </tr>
                      {!isCollapsed && group.tasks.map(({ task, depth }) => {
                        const taskId = Number(task.id)
                        const children = childrenByParentId.get(taskId) ?? []
                        const hasChildren = children.length > 0
                        const childStats = childStatsByParentId.get(taskId)
                        const childProgress = childStats ? `${childStats.done}/${childStats.total} subtasks complete` : null

                        return (
                          <Fragment key={`row-group-${taskId}`}>
                            <TaskListRow
                              task={task}
                              depth={depth}
                              hasChildren={hasChildren}
                              isExpanded={hasChildren ? expandedParentIds.has(taskId) : undefined}
                              childProgress={childProgress}
                              onToggleChildren={hasChildren ? toggleChildren : undefined}
                              onAddChild={beginAddChild}
                              isAddingChild={addingChildForTaskId === taskId}
                              onEdit={setEditingTask}
                              onHistory={setHistoryTask}
                              onDelete={handleDelete}
                              onStatusCycle={handleStatusCycle}
                            />
                            {addingChildForTaskId === taskId && (
                              <tr key={`add-child-${taskId}`} className="t-list-row t-list-row--child-editor">
                                <td className="t-list-cell" colSpan={5}>
                                  <div className="t-subtask-editor">
                                    <span className="t-subtask-label">New subtask</span>
                                    <input
                                      className="t-input"
                                      placeholder="Enter subtask title"
                                      value={childDraftTitle}
                                      onChange={e => setChildDraftTitle(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') { e.preventDefault(); submitAddChild() }
                                        if (e.key === 'Escape') { setAddingChildForTaskId(null); setChildDraftTitle('') }
                                      }}
                                    />
                                    <button className="t-btn" onClick={() => { setAddingChildForTaskId(null); setChildDraftTitle('') }}>Cancel</button>
                                    <button className="t-btn-primary" onClick={submitAddChild} disabled={!childDraftTitle.trim()}>Add</button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </Fragment>
                  )
                })}
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
  if (code === 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED') return 'Completed tasks assigned to past days cannot be reopened.'
  if (code === 'TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN' || code === 'TASK_PARENT_INCOMPLETE_CHILDREN') return 'Parent tasks cannot be completed while child tasks are still open.'
  if (code === 'TASK_PARENT_SELF_NOT_ALLOWED') return 'A task cannot be set as its own parent.'
  if (code === 'TASK_PARENT_CYCLE_NOT_ALLOWED') return 'This parent assignment would create a cycle.'
  if (code === 'TASK_PARENT_DEPTH_NOT_ALLOWED') return 'Only one subtask level is supported.'
  if (code === 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN') return 'This task has subtasks. Remove or reassign subtasks before deleting.'
  if (code === 'TASK_PARENT_NOT_FOUND') return 'The selected parent task was not found.'
  if (code === 'TASK_CREATION_PAST_DAY_NOT_ALLOWED') return 'You cannot create new tasks on a past journal day.'
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
    case 'activeToday': return assignedDate === todayISO() && !isCompleted
    case 'scheduledFuture': return assignedDate != null && assignedDate > todayISO()
    case 'completedHistory': return isCompleted && assignedDate != null && assignedDate < todayISO()
    default: return true
  }
}
