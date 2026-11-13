import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  useTasksQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useBlockTaskMutation,
  useUnblockTaskMutation,
  useEditBlockedReasonMutation,
  type CreateTaskPayload,
  type TaskItemViewModel,
  type UpdateTaskPayload,
} from '@/hooks/useTasks'
import { useProjectsQuery } from '@/hooks/useProjects'
import { useDeleteTaskUndoable } from '@/hooks/useDeleteTaskUndoable'
import { getErrorCode, getTaskMutationErrorMessage } from '@/lib/task-errors'
import { normalizeProjectId, PROJECT_CREATE_NOT_FOUND_MESSAGE } from '@/lib/project-errors'
import { usePrefs } from '@/context/usePrefs'
import { useCollapsedGroups } from '@/hooks/useCollapsedGroups'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { TaskListRow } from '@/components/TaskListRow'
import { TaskContextHeader } from '@/components/TaskContextHeader'
import { TaskHistoryPanel } from '@/components/TaskHistoryPanel'
import { TaskForm, type TaskFormPayload, type ProjectOption } from '@/components/TaskForm'
import type { TaskSortKey } from '@/lib/prefs'
import { journalDayOf, todayISO } from '@/lib/journal-utils'
import {
  readFocusTaskId,
  stateWithoutFocusTaskId,
  taskEditPath,
  tasksOriginPath,
  type TaskOriginState,
} from '@/lib/task-origin'
import {
  buildTaskFiltersSearch,
  parseTaskFilters,
  type ProjectFilter,
  type TaskFilters,
} from '@/lib/task-filters-url'
import { deriveTaskStatuses, getParentProgressLabel } from '@/lib/task-derived-status'
import {
  buildTaskSections,
  findSectionOfTask,
  findSectionShowingTask,
  indexTasksById,
  matchesSearchWithAncestors,
} from '@/lib/task-sections'
import { parseTaskId } from '@/lib/task-id-search'
import {
  STATUS_LABELS,
  STATUS_ORDER,
  isBlocked,
  isCompleted,
  nextCycleStatus,
  normalizeStatus,
  statusRank,
  toRequestStatus,
  type RequestStatus,
} from '@/lib/task-status'
import '@/tasks.css'

type StatusValue = RequestStatus
const STATUS_OPTIONS: Array<{ value: StatusValue; label: string }> = STATUS_ORDER.map(status => ({
  value: toRequestStatus(status),
  label: STATUS_LABELS[status],
}))
const DEFAULT_STATUS_FILTER: StatusValue[] = ['draft', 'todo', 'inProgress', 'blocked', 'completed']
type ViewFilter = TaskFilters['view']

type TaskListModel = TaskItemViewModel

/** The Add subtask editor is open for one clicked instance: `row` (work row) or `ctx:<sectionKey>` (header). */
interface AddingChild {
  parentId: number
  anchor: string
}

const addAnchorAttr = (a: AddingChild) => `${a.anchor}:${a.parentId}`

/** Filter dimensions that differ from the defaults; shown as "Filters (n)" on phones. View chips and search do not count. */
function countActiveFilters(status: Set<StatusValue>, project: ProjectFilter): number {
  const statusDiffers =
    status.size !== DEFAULT_STATUS_FILTER.length || DEFAULT_STATUS_FILTER.some(s => !status.has(s))
  return (statusDiffers ? 1 : 0) + (project !== 'all' ? 1 : 0)
}

function isNarrowViewport(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 820px)').matches
}

const COLUMNS: Array<{ key: TaskSortKey; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'dueDate', label: 'Due Date' },
]

export function TasksPage() {
  const { data, isLoading, isFetching, error } = useTasksQuery()
  const createMutation = useCreateTaskMutation()
  const updateMutation = useUpdateTaskMutation()
  const deleteTaskUndoable = useDeleteTaskUndoable()
  const location = useLocation()
  const navigate = useNavigate()
  const blockMutation = useBlockTaskMutation()
  const unblockMutation = useUnblockTaskMutation()
  const editReasonMutation = useEditBlockedReasonMutation()
  const {
    taskSortKey,
    setTaskSortKey,
    taskSortDir,
    setTaskSortDir,
    autoCompleteParentWhenChildrenDone,
  } = usePrefs()

  // The URL is the single source of truth for status, view, project and search text (see lib/task-filters-url).
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const filters = useMemo(() => parseTaskFilters(new URLSearchParams(paramsKey)), [paramsKey])
  // Parsed once: seeds the search input and the mobile panel on first render and never changes.
  const [initialFilters] = useState(() => parseTaskFilters(searchParams))
  const statusFilter = filters.statuses
  const viewFilter = filters.view
  const urlProject = filters.project

  // Filter changes replace the entry, so Back does not step through filter states.
  function writeFilters(next: TaskFilters) {
    setSearchParams(buildTaskFiltersSearch(next), { replace: true, state: location.state })
  }
  const toggleStatus = (v: StatusValue) => {
    const next = new Set(statusFilter)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    writeFilters({ ...filters, statuses: next })
  }
  const setViewFilter = (view: ViewFilter) => writeFilters({ ...filters, view })
  const setProjectFilter = (project: ProjectFilter) => writeFilters({ ...filters, project })
  const [createProjectInvalid, setCreateProjectInvalid] = useState(false)
  const projectsQuery = useProjectsQuery()
  // Local text keeps typing instant; the URL is written from the debounce below.
  const [searchQuery, setSearchQuery] = useState(initialFilters.search)
  const [debouncedSearch, setDebouncedSearch] = useState(initialFilters.search)
  // Last URL `q` seen, and the last `q` this page wrote. A URL `q` we did not write (Back, Nav, `g t`) re-syncs the input.
  const [seenUrlSearch, setSeenUrlSearch] = useState(initialFilters.search)
  const [wroteSearch, setWroteSearch] = useState(initialFilters.search)
  if (filters.search !== seenUrlSearch) {
    setSeenUrlSearch(filters.search)
    if (filters.search !== wroteSearch) {
      setWroteSearch(filters.search)
      setSearchQuery(filters.search)
      setDebouncedSearch(filters.search)
    }
  }
  const [historyTask, setHistoryTask] = useState<TaskListModel | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [liveMessage, setLiveMessage] = useState('')
  const { isCollapsed: isSectionCollapsed, toggle: toggleSection } = useCollapsedGroups()
  const [addingChild, setAddingChild] = useState<AddingChild | null>(null)
  const [childDraftTitle, setChildDraftTitle] = useState('')
  // A failed block rolls its row back as a new instance, so the page carries the typed reason across the remount.
  const [blockRetry, setBlockRetry] = useState<{ id: number; reason: string } | null>(null)
  const historyCloseRef = useRef<HTMLButtonElement | null>(null)
  const historyModalRef = useRef<HTMLDivElement | null>(null)
  const listWrapRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const newTaskBtnRef = useRef<HTMLButtonElement | null>(null)
  const [panelFocusTick, setPanelFocusTick] = useState(0)
  // Seed: open on first render only when a filter inside the panel (status or project) restored from the URL is
  // non-default. Search and view sit outside the panel. Never re-derived afterwards, so changing or clearing a
  // filter, or a URL update, keeps the panel open/closed as the user left it.
  const [filtersOpen, setFiltersOpen] = useState(
    () => countActiveFilters(initialFilters.statuses, initialFilters.project) > 0,
  )
  // Status control to re-focus after a status change moves its row (survives the optimistic move and the rollback).
  const pendingStatusFocusRef = useRef<{ id: number; settled: boolean; announced: boolean } | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  // Set after a successful Add subtask; resolved once the refetch has brought the new task into the list.
  const pendingAddFocusRef = useRef<{ anchorAttr: string; newId: number | null; parentTitle: string } | null>(null)
  // Set by a detail-page delete: focus New Task once on arrival. Captured on mount so a plain visit never does.
  const focusNewTaskRef = useRef((location.state as { focusNewTask?: boolean } | null)?.focusNewTask === true)

  // Set when the detail page returns here: focus that task's control once the list settles. Cleared at settle, not on mount.
  const pendingFocusTaskIdRef = useRef(readFocusTaskId(location.state))

  // Clear the route state on mount whether or not the button ever renders (e.g. on a load error).
  useEffect(() => {
    if (!focusNewTaskRef.current) return
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The button only renders once the list has loaded, so this re-runs until the ref is set.
  useEffect(() => {
    if (!focusNewTaskRef.current || !newTaskBtnRef.current) return
    focusNewTaskRef.current = false
    newTaskBtnRef.current.focus()
  }, [isLoading, error])

  // Latest values for the debounce timer, which outlives the render that scheduled it.
  const latestRef = useRef({ filters, writeFilters })
  useEffect(() => {
    latestRef.current = { filters, writeFilters }
  })

  // Debounce search input; the URL gets the text once it settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      const latest = latestRef.current
      if (searchQuery !== latest.filters.search) {
        setWroteSearch(searchQuery)
        latest.writeFilters({ ...latest.filters, search: searchQuery })
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Declared before the focus effect below so the opener is captured before focus moves into the sheet.
  // fallbackRef: iOS Safari does not focus a tapped button, so the opener may be body.
  useFocusTrap(historyModalRef, historyTask !== null, { fallbackRef: listWrapRef })

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

  // New Task: focus the title on every viewport so Escape works from the keyboard (#470);
  // bring the top panel into view only on a phone or tablet.
  // Runs after the panel has mounted (effect), and only when a click requested it.
  useEffect(() => {
    if (panelFocusTick === 0) return
    if (isNarrowViewport()) panelRef.current?.scrollIntoView({ block: 'start' })
    titleRef.current?.focus({ preventScroll: true })
  }, [panelFocusTick])

  // New Task panel closed (Save / Cancel): return focus to New Task.
  const panelKind = showCreate ? 'new' : null
  const prevPanelKindRef = useRef<string | null>(null)
  const tasks: TaskListModel[] = useMemo(
    () => (data?.data as TaskListModel[] | undefined) ?? [],
    [data],
  )
  // Derived from the full, unfiltered list so a filtered-out subtask still counts. Render-only: never cached.
  const derived = useMemo(() => deriveTaskStatuses(tasks), [tasks])
  const statusOf = useCallback(
    (t: TaskListModel): string | undefined => derived.get(Number(t.id))?.displayStatus ?? t.status,
    [derived],
  )
  const isLocked = useCallback((t: TaskListModel) => derived.get(Number(t.id))?.isDerived === true, [derived])
  useEffect(() => {
    const prev = prevPanelKindRef.current
    prevPanelKindRef.current = panelKind
    if (panelKind === null && prev === 'new') newTaskBtnRef.current?.focus()
  }, [panelKind])

  const projects: ProjectOption[] = useMemo(
    () =>
      [...(projectsQuery.data?.data ?? [])]
        .map(p => ({ id: Number(p.id), name: p.name, isArchived: !!p.isArchived }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projectsQuery.data],
  )
  const filterProjects = useMemo(
    () => [...projects.filter(p => !p.isArchived), ...projects.filter(p => p.isArchived)],
    [projects],
  )

  // A filter pointing at a project that no longer exists would hide every task. Only treat it as stale once
  // the projects query has succeeded: loading or errored fetches are not evidence that the project is gone.
  const projectIsStale =
    projectsQuery.isSuccess && typeof urlProject === 'number' && !projects.some(p => p.id === urlProject)
  // Until the effect below strips it from the URL, a stale project counts as "all" so nothing flickers.
  const projectFilter: ProjectFilter = projectIsStale ? 'all' : urlProject

  useEffect(() => {
    if (!projectIsStale) return
    const next = new URLSearchParams(searchParams)
    next.delete('project')
    setSearchParams(next, { replace: true, state: location.state })
  }, [projectIsStale, searchParams, setSearchParams, location.state])

  function handleSortClick(key: TaskSortKey) {
    if (key === taskSortKey) {
      setTaskSortDir(taskSortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setTaskSortKey(key)
      setTaskSortDir('asc')
    }
  }

  function handleSortKeyChange(key: TaskSortKey) {
    if (key === taskSortKey) return
    setTaskSortKey(key)
    setTaskSortDir('asc')
  }

  function requestPanelFocus() {
    setPanelFocusTick(t => t + 1)
  }

  // Carried by Edit, the title link and the parent link so the detail page can return to this filtered list.
  const originState: TaskOriginState = { from: tasksOriginPath(location.search) }
  // Per entry point: also names the task to focus when the detail page returns here. Never mutates originState.
  const stateFor = (id: number): TaskOriginState => ({ ...originState, focusTaskId: id })

  function openEdit(task: TaskListModel) {
    navigate(taskEditPath(Number(task.id)), { state: stateFor(Number(task.id)) })
  }

  function openCreate() {
    setShowCreate(true)
    requestPanelFocus()
  }

  function sortIcon(key: TaskSortKey): string {
    if (key !== taskSortKey) return ''
    return taskSortDir === 'asc' ? ' ↑' : ' ↓'
  }

  const allById = useMemo(() => indexTasksById(tasks), [tasks])

  // Apply filters: view filter, status filter, project filter, search (a parent's title also matches its subtasks)
  const searchId = useMemo(() => parseTaskId(debouncedSearch), [debouncedSearch])
  const visibleTasks = useMemo(() => {
    const allStatusesChecked = STATUS_OPTIONS.every(o => statusFilter.has(o.value))
    const today = todayISO()
    return tasks
      .filter(t => matchesViewFilter(t, viewFilter, statusOf(t), today))
      .filter(t => {
        if (statusFilter.size === 0) return true
        const normalized = normalizeStatus(statusOf(t))
        // An unrecognized status passes only when no status is excluded.
        if (!normalized) return allStatusesChecked
        return statusFilter.has(toRequestStatus(normalized))
      })
      .filter(t => {
        if (projectFilter === 'all') return true
        const taskProjectId = normalizeProjectId(t.projectId)
        return projectFilter === 'none' ? taskProjectId === null : taskProjectId === projectFilter
      })
      .filter(t => {
        if (!debouncedSearch.trim()) return true
        if (searchId !== null && Number(t.id) === searchId) return true
        return matchesSearchWithAncestors(t, allById, debouncedSearch)
      })
  }, [searchId, tasks, allById, statusOf, viewFilter, statusFilter, projectFilter, debouncedSearch])

  const compareWithinGroup = useCallback((a: TaskListModel, b: TaskListModel): number => {
    const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
    let cmp: number
    const aDue = a.dueDate ?? ''
    const bDue = b.dueDate ?? ''

    if (taskSortKey === 'title') {
      cmp = a.title.localeCompare(b.title)
    } else if (taskSortKey === 'status') {
      cmp = statusRank(statusOf(a)) - statusRank(statusOf(b))
    } else if (taskSortKey === 'priority') {
      // A missing or unrecognized priority sorts as High, matching the section fallback.
      const pa = PRIORITY_ORDER[(a.priority ?? '').toLowerCase()] ?? 0
      const pb = PRIORITY_ORDER[(b.priority ?? '').toLowerCase()] ?? 0
      cmp = pa - pb
    } else {
      // Default: due date - no-date items sort last in asc, first in desc
      if (!aDue && bDue) return taskSortDir === 'asc' ? 1 : -1
      if (aDue && !bDue) return taskSortDir === 'asc' ? -1 : 1
      cmp = aDue.localeCompare(bDue)
    }

    return taskSortDir === 'asc' ? cmp : -cmp
  }, [taskSortKey, taskSortDir, statusOf])

  const childStatsByParentId = useMemo(() => {
    const stats = new Map<number, { done: number; total: number }>()
    tasks.forEach(task => {
      const parentId = task.parentTaskItemId ? Number(task.parentTaskItemId) : null
      if (!parentId) return
      const prev = stats.get(parentId) ?? { done: 0, total: 0 }
      // Progress counts done subtasks only; a parent with a visible blocked subtask is a header, not a row.
      stats.set(parentId, { total: prev.total + 1, done: prev.done + (isCompleted(task.status) ? 1 : 0) })
    })
    return stats
  }, [tasks])

  const sections = useMemo(
    () => buildTaskSections({ allTasks: tasks, visibleTasks, compare: compareWithinGroup, statusOf }),
    [tasks, visibleTasks, compareWithinGroup, statusOf],
  )

  // After a row changes section it remounts and loses focus: put it back on its status control, or on the
  // destination section's toggle when that section is collapsed (its rows are not rendered). A subtask
  // added from a header returns focus to the clicked button, else the new row's status control, else its section toggle.
  useLayoutEffect(() => {
    const pending = pendingStatusFocusRef.current
    if (pending) {
      const control = document.querySelector<HTMLElement>(`[data-task-status-id="${pending.id}"]`)
      const section = findSectionOfTask(sections, pending.id)
      const active = document.activeElement
      // Only take focus back when it was lost, or from a toggle this flow focused (a rollback leaves it there).
      const mayRestore =
        !active || active === document.body || !active.isConnected || active.hasAttribute('data-section-toggle')
      if (mayRestore) {
        if (control) control.focus()
        else if (section) document.querySelector<HTMLElement>(`[data-section-toggle="${section.key}"]`)?.focus()
      }
      if (section && !pending.announced) {
        pending.announced = true
        setLiveMessage(`Moved to ${section.label}`)
      }
      if (pending.settled) pendingStatusFocusRef.current = null
    }

    const add = pendingAddFocusRef.current
    if (add && (add.newId === null || allById.has(add.newId))) {
      pendingAddFocusRef.current = null
      const section = add.newId === null ? undefined : findSectionOfTask(sections, add.newId)
      setLiveMessage(
        section
          ? `Subtask added under ${add.parentTitle} in ${section.label}`
          : `Subtask added under ${add.parentTitle}`,
      )
      const active = document.activeElement
      if (!active || active === document.body || !active.isConnected) {
        const target =
          document.querySelector<HTMLElement>(`[data-add-child-anchor="${add.anchorAttr}"]`) ??
          (add.newId === null ? null : document.querySelector<HTMLElement>(`[data-task-status-id="${add.newId}"]`)) ??
          (section ? document.querySelector<HTMLElement>(`[data-section-toggle="${section.key}"]`) : null)
        target?.focus()
      }
    }
  }, [sections, allById, focusTick])

  // Return from the detail page: focus the control the user left from, once the list has settled. Never expands
  // a collapsed section (its toggle takes the focus). Abandoned silently when the task is gone or the load failed.
  useLayoutEffect(() => {
    const pendingId = pendingFocusTaskIdRef.current
    if (pendingId === null) return
    if (isLoading || isFetching) return
    pendingFocusTaskIdRef.current = null
    if (!error && pendingStatusFocusRef.current === null) {
      const active = document.activeElement
      if (!active || active === document.body || !active.isConnected) {
        const section = findSectionShowingTask(sections, pendingId)
        if (section) {
          const target = isSectionCollapsed(section.key)
            ? document.querySelector<HTMLElement>(`[data-section-toggle="${section.key}"]`)
            : document.querySelector<HTMLElement>(
                `[data-task-edit-id="${pendingId}"], [data-task-header-id="${pendingId}"]`,
              )
          target?.focus()
        }
      }
    }
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: stateWithoutFocusTaskId(location.state) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, isLoading, isFetching, error])

  // Handlers
  function clearFormErrors() {
    setMutationError(null)
    setCreateProjectInvalid(false)
  }

  function handleCreate(formData: TaskFormPayload) {
    if (createMutation.isPending) return
    clearFormErrors()
    createMutation.mutate(formData as CreateTaskPayload, {
      onSuccess: () => setShowCreate(false),
      onError: err => {
        if (getErrorCode(err) === 'TASK_PROJECT_NOT_FOUND') {
          setMutationError(PROJECT_CREATE_NOT_FOUND_MESSAGE)
          setCreateProjectInvalid(true)
        } else {
          setMutationError(getTaskMutationErrorMessage(err))
        }
      },
    })
  }

  function handleStatusCycle(task: TaskListModel) {
    // A parent whose status follows its open subtasks is read-only (the UI already hides the control).
    if (isLocked(task)) return
    // Unknown and Blocked statuses are not in the cycle (Blocked is unblocked via its badge).
    const nextStatus = nextCycleStatus(task.status)
    if (!nextStatus) return
    setMutationError(null)
    const id = Number(task.id)
    pendingStatusFocusRef.current = { id, settled: false, announced: false }
    updateMutation.mutate(
      {
        id,
        data: {
          title: task.title,
          description: task.description,
          status: nextStatus,
          priority: task.priority as 'low' | 'medium' | 'high' | undefined,
          dueDate: task.dueDate,
          parentTaskItemId: task.parentTaskItemId,
          autoCompleteParentWhenChildrenDone,
        } as UpdateTaskPayload,
      },
      {
        onError: err => setMutationError(getTaskMutationErrorMessage(err)),
        onSettled: () => markStatusFocusSettled(id),
      }
    )
  }

  function markStatusFocusSettled(id: number) {
    if (pendingStatusFocusRef.current?.id === id) pendingStatusFocusRef.current.settled = true
    setFocusTick(t => t + 1)
  }

  async function handleBlock(task: TaskListModel, reason: string) {
    if (isLocked(task)) return
    setMutationError(null)
    setBlockRetry(null)
    const id = Number(task.id)
    // Already announced: success has its own "Task blocked" message and failure has the alert.
    pendingStatusFocusRef.current = { id, settled: false, announced: true }
    try {
      await blockMutation.mutateAsync({ id, reason })
      setLiveMessage(`Task blocked: ${task.title}`)
    } catch (err) {
      // The re-opened input takes focus, so the status control must not.
      if (pendingStatusFocusRef.current?.id === id) pendingStatusFocusRef.current = null
      setMutationError(getTaskMutationErrorMessage(err))
      setBlockRetry({ id, reason })
      throw err
    } finally {
      markStatusFocusSettled(id)
    }
  }

  function handleUnblock(task: TaskListModel) {
    if (isLocked(task)) return
    setMutationError(null)
    const id = Number(task.id)
    pendingStatusFocusRef.current = { id, settled: false, announced: false }
    unblockMutation.mutate(
      { id },
      {
        onSuccess: () => setLiveMessage(`Task unblocked: ${task.title}`),
        onError: err => setMutationError(getTaskMutationErrorMessage(err)),
        onSettled: () => markStatusFocusSettled(id),
      },
    )
  }

  async function handleEditBlockedReason(task: TaskListModel, reason: string) {
    setMutationError(null)
    try {
      await editReasonMutation.mutateAsync({ id: Number(task.id), reason })
    } catch (err) {
      setMutationError(getTaskMutationErrorMessage(err))
      throw err
    }
  }

  const parentOptions = tasks
    .map(t => ({ id: Number(t.id), title: t.title, status: t.status }))

  // Stored status on purpose (not statusOf): a Completed parent with an open child is still gated.
  function isParentCompleted(id: number): boolean {
    return isCompleted(allById.get(id)?.status)
  }

  function handleDelete(task: TaskListModel) {
    const id = Number(task.id)
    setMutationError(null)
    // Focus moves synchronously, before the row unmounts: next row's Delete (skipping group headers and
    // collapsed groups, which the DOM query does for free), else the previous, else New Task.
    const all = [...document.querySelectorAll<HTMLElement>('[data-task-delete-id]')]
    const index = all.findIndex(el => el.dataset.taskDeleteId === String(id))
    const next = index >= 0 ? (all[index + 1] ?? all[index - 1]) : undefined
    ;(next ?? newTaskBtnRef.current)?.focus()
    if (addingChild?.parentId === id) { setAddingChild(null); setChildDraftTitle('') }
    deleteTaskUndoable({ id, title: task.title }, () => {
      document.querySelector<HTMLElement>(`[data-task-delete-id="${id}"]`)?.focus()
    })
  }

  function beginAddChild(parentId: number, anchor: string) {
    if (isParentCompleted(parentId)) return
    setMutationError(null)
    setAddingChild({ parentId, anchor })
    setChildDraftTitle('')
  }

  function closeAddChild() {
    // Focus the clicked button first; it is always present while the editor is open.
    if (addingChild) {
      document.querySelector<HTMLElement>(`[data-add-child-anchor="${addAnchorAttr(addingChild)}"]`)?.focus()
    }
    setAddingChild(null)
    setChildDraftTitle('')
  }

  function submitAddChild() {
    if (!addingChild) return
    const { parentId } = addingChild
    const anchorAttr = addAnchorAttr(addingChild)
    const title = childDraftTitle.trim()
    if (!parentId || !title) return
    setMutationError(null)
    createMutation.mutate(
      { title, status: 'todo', parentTaskItemId: parentId } as CreateTaskPayload,
      {
        onSuccess: result => {
          const rawId = (result as { data?: { id?: number | string | null } } | undefined)?.data?.id
          const newId = rawId === undefined || rawId === null ? null : Number(rawId)
          pendingAddFocusRef.current = {
            anchorAttr,
            newId: newId !== null && Number.isFinite(newId) ? newId : null,
            parentTitle: allById.get(parentId)?.title ?? '',
          }
          document.querySelector<HTMLElement>(`[data-add-child-anchor="${anchorAttr}"]`)?.focus()
          setAddingChild(null)
          setChildDraftTitle('')
          // The list may already be current (nothing else would re-run the focus effect).
          setFocusTick(t => t + 1)
        },
        onError: err => setMutationError(getTaskMutationErrorMessage(err)),
      },
    )
  }

  const formError = mutationError
  const blockedTotal = tasks.filter(t => isBlocked(statusOf(t))).length
  const activeFilterCount = countActiveFilters(statusFilter, projectFilter)
  const totalFiltered = sections.reduce((sum, section) => sum + section.workRowCount, 0)

  function renderChildEditor(key: string) {
    return (
      <tr key={key} role="row" className="t-list-row t-list-row--child-editor">
        <td role="cell" className="t-list-cell" colSpan={5}>
          <div className="t-subtask-editor">
            <span className="t-subtask-label">New subtask</span>
            <input
              className="t-input"
              placeholder="Enter subtask title"
              aria-label={`New subtask for ${allById.get(addingChild?.parentId ?? 0)?.title ?? 'task'}`}
              autoFocus
              value={childDraftTitle}
              onChange={e => setChildDraftTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); submitAddChild() }
                if (e.key === 'Escape') closeAddChild()
              }}
            />
            <button className="t-btn" onClick={closeAddChild}>Cancel</button>
            <button className="t-btn-primary" onClick={submitAddChild} disabled={!childDraftTitle.trim()}>Add</button>
          </div>
        </td>
      </tr>
    )
  }

  if (isLoading) return <div className="tasks-page"><div className="t-shell"><p className="t-loading">Loading tasks...</p></div></div>
  if (error) return <div className="tasks-page"><div className="t-shell"><p className="t-error" role="alert">Failed to load tasks.</p></div></div>

  return (
    <div className="tasks-page t-list-page">
      <div className="t-shell">
        <div className="t-page-hdr">
          <h1 className="t-page-title">Tasks</h1>
          <button ref={newTaskBtnRef} className="t-btn-primary" onClick={openCreate}>New Task</button>
        </div>

        {showCreate && (
          <div ref={panelRef} className="t-panel t-edit-panel">
            <h2 className="t-panel-title">New Task</h2>
            {formError && <p className="t-inline-error" role="alert">{formError}</p>}
            <TaskForm
              availableParents={parentOptions}
              projects={projects}
              // Preselect the filtered project when creating a task.
              defaultProjectId={typeof projectFilter === 'number' ? projectFilter : null}
              projectInvalid={createProjectInvalid}
              onProjectChange={() => setCreateProjectInvalid(false)}
              onParentOrStatusChange={clearFormErrors}
              isSaving={createMutation.isPending}
              onSubmit={handleCreate}
              onCancel={() => { setShowCreate(false); clearFormErrors() }}
              titleInputRef={titleRef}
            />
          </div>
        )}

        {historyTask && (
          <>
            <div className="sheet-backdrop" onClick={() => setHistoryTask(null)} aria-hidden="true" />
            <div ref={historyModalRef} className="sheet tasks-history-sheet" role="dialog" aria-modal="true" aria-labelledby="task-history-title">
              <div className="sheet-header">
                <div>
                  <h2 id="task-history-title" className="t-panel-title t-panel-title--tight">Task history</h2>
                  <div className="t-history-subtitle">{historyTask.title}</div>
                </div>
                <button ref={historyCloseRef} type="button" className="sheet-close" onClick={() => setHistoryTask(null)}>Close</button>
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
              placeholder="Search title or #id…"
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
          <button
            type="button"
            className="t-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="t-filter-fields"
            onClick={() => setFiltersOpen(open => !open)}
          >
            {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
            <span className="t-filter-chevron" aria-hidden="true">{'▾'}</span>
          </button>
          {/* Sort control: shown only on phones, where the column headers are visually hidden. */}
          <div className="t-sort-control">
            <label htmlFor="task-sort-key" className="t-filter-label">Sort by</label>
            <select
              id="task-sort-key"
              className="t-select"
              value={taskSortKey}
              onChange={e => handleSortKeyChange(e.target.value as TaskSortKey)}
            >
              {COLUMNS.map(col => <option key={col.key} value={col.key}>{col.label}</option>)}
            </select>
            {/* The label names what a tap will do: ascending now => "Sort descending". */}
            <button
              type="button"
              className="t-btn-icon t-sort-dir"
              aria-label={taskSortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
              onClick={() => setTaskSortDir(taskSortDir === 'asc' ? 'desc' : 'asc')}
            >
              <span aria-hidden="true">{taskSortDir === 'asc' ? '↑' : '↓'}</span>
            </button>
          </div>
          <div id="t-filter-fields" className="t-filter-fields" data-collapsed={!filtersOpen}>
          <div className="t-filter-field t-status-group" role="group" aria-labelledby="status-filter-label">
            <span id="status-filter-label" className="t-filter-label">Status</span>
            {STATUS_OPTIONS.map(o => (
              <label key={o.value} className="t-status-option">
                <input type="checkbox" checked={statusFilter.has(o.value)} onChange={() => toggleStatus(o.value)} />
                {o.label}
                {o.value === 'blocked' && <>{' '}<span className="t-status-count">({blockedTotal})</span></>}
              </label>
            ))}
          </div>
          <span className="t-filter-field">
            <label htmlFor="project-filter" className="t-filter-label">Project</label>
            <select
              id="project-filter"
              className="t-select"
              value={String(projectFilter)}
              onChange={e => {
                const v = e.target.value
                setProjectFilter(v === 'all' || v === 'none' ? v : Number(v))
              }}
            >
              <option value="all">All projects</option>
              <option value="none">No project</option>
              {filterProjects.map(p => (
                <option key={p.id} value={String(p.id)}>{p.isArchived ? `${p.name} (archived)` : p.name}</option>
              ))}
            </select>
          </span>
          </div>
          <span className="t-filter-count">{totalFiltered} task{totalFiltered !== 1 ? 's' : ''}</span>
        </div>

        {/* Persistent polite live region for block/unblock announcements. */}
        <div role="status" className="sr-only">{liveMessage}</div>

        {mutationError && !showCreate && <p className="t-inline-error" role="alert">{mutationError}</p>}

        {totalFiltered === 0 ? (
          <p className="t-empty">No tasks match your filters.</p>
        ) : (
          <div ref={listWrapRef} tabIndex={-1} className="t-list-wrap">
            <table role="table" className="t-list-table">
              <thead role="rowgroup">
                <tr role="row" className="t-list-head-row">
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      role="columnheader"
                      className={`t-list-th${col.key === taskSortKey ? ' t-col-sort--active' : ''}`}
                      aria-sort={col.key === taskSortKey ? (taskSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" className="t-col-sort-btn" onClick={() => handleSortClick(col.key)}>
                        {col.label}{sortIcon(col.key)}
                      </button>
                    </th>
                  ))}
                  <th role="columnheader" className="t-list-th t-list-th--actions" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {sections.map(section => {
                  const collapsed = isSectionCollapsed(section.key)
                  return (
                    <Fragment key={section.key}>
                      <tr role="row" className={`t-group-header t-group-header--${section.cssModifier}`}>
                        <td role="cell" colSpan={5}>
                          <button
                            type="button"
                            className="t-group-toggle"
                            aria-expanded={!collapsed}
                            data-section-toggle={section.key}
                            onClick={() => toggleSection(section.key)}
                          >
                            <span aria-hidden="true" className={`t-group-chevron${collapsed ? ' t-group-chevron--collapsed' : ''}`}>{'▾'}</span>
                            {section.label}{' '}
                            <span className="t-group-count">{'·'} {section.workRowCount} task{section.workRowCount !== 1 ? 's' : ''}</span>
                          </button>
                        </td>
                      </tr>
                      {!collapsed && section.blocks.flatMap(block => {
                        const items: ReactNode[] = []
                        const header = block.header
                        if (header) {
                          const anchor = `ctx:${section.key}`
                          const addingHeader = addingChild?.anchor === anchor && addingChild.parentId === header.parentId
                          const headerInfo = derived.get(header.parentId)
                          items.push(
                            <TaskContextHeader
                              key={`${section.key}:ctx:${header.parentId}`}
                              path={header.path}
                              parentId={header.parentId}
                              anchor={`${anchor}:${header.parentId}`}
                              sectionLabel={section.label}
                              isAdding={addingHeader}
                              onAddChild={() => beginAddChild(header.parentId, anchor)}
                              addSubtaskDisabled={isParentCompleted(header.parentId)}
                              progressLabel={headerInfo && headerInfo.directTotal > 0 ? getParentProgressLabel(headerInfo) : undefined}
                              linkState={stateFor(header.parentId)}
                            />,
                          )
                          if (addingHeader) items.push(renderChildEditor(`${section.key}:ctx-editor:${header.parentId}`))
                        }
                        block.rows.forEach(task => {
                          const taskId = Number(task.id)
                          const childStats = childStatsByParentId.get(taskId)
                          const childProgress = childStats
                            ? `${childStats.done}/${childStats.total} subtasks complete`
                            : null
                          const addingHere = addingChild?.anchor === 'row' && addingChild.parentId === taskId
                          items.push(
                            <Fragment key={`${section.key}:${taskId}`}>
                              <TaskListRow
                                task={task}
                                depth={header ? 1 : 0}
                                childProgress={childProgress}
                                displayStatus={statusOf(task)}
                                statusLocked={isLocked(task)}
                                openChildCount={derived.get(taskId)?.openChildCount ?? 0}
                                onAddChild={t => beginAddChild(Number(t.id), 'row')}
                                isAddingChild={addingHere}
                                addSubtaskDisabled={isCompleted(task.status)}
                                detailState={stateFor(taskId)}
                                onEdit={openEdit}
                                onHistory={setHistoryTask}
                                onDelete={handleDelete}
                                onStatusCycle={handleStatusCycle}
                                onBlock={handleBlock}
                                blockRetryReason={blockRetry?.id === taskId && !isBlocked(statusOf(task)) ? blockRetry.reason : null}
                                onBlockRetryShown={() => setBlockRetry(null)}
                                onUnblock={handleUnblock}
                                onEditBlockedReason={handleEditBlockedReason}
                              />
                              {addingHere && renderChildEditor(`${section.key}:editor:${taskId}`)}
                            </Fragment>,
                          )
                        })
                        return items
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

function matchesViewFilter(
  task: TaskListModel,
  viewFilter: ViewFilter,
  status: string | undefined,
  today = todayISO(),
): boolean {
  // Blocked counts as not completed. A shown-completed task is filed by its completion day, others by their linked day.
  const completed = isCompleted(status)
  const day = completed ? journalDayOf(task) : task.currentJournalDate ?? null
  switch (viewFilter) {
    case 'activeToday': return !completed && day === today
    case 'scheduledFuture': return !completed && day != null && day > today
    case 'completedHistory': return completed && day != null && day <= today
    default: return true
  }
}
