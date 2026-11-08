import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { TasksPage } from './TasksPage'

vi.mock('@/hooks/useTasks', () => ({
  useTasksQuery: vi.fn(),
  useCreateTaskMutation: vi.fn(),
  useUpdateTaskMutation: vi.fn(),
  useBlockTaskMutation: vi.fn(),
  useUnblockTaskMutation: vi.fn(),
  useEditBlockedReasonMutation: vi.fn(),
  taskKeys: {
    all: ['tasks'],
    detail: (id: number) => ['tasks', id],
    history: (id: number) => ['tasks', id, 'history'],
  },
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjectsQuery: vi.fn(),
  useChangeTaskProject: vi.fn(),
}))

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(),
}))

import {
  useTasksQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useBlockTaskMutation,
  useUnblockTaskMutation,
  useEditBlockedReasonMutation,
} from '@/hooks/useTasks'
import { useProjectsQuery, useChangeTaskProject } from '@/hooks/useProjects'
import { usePrefs } from '@/context/usePrefs'
import type { PrefsContextValue } from '@/context/PrefsContextDef'

const taskMutations = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }

const baseTask = {
  description: null,
  priority: 'Low',
  dueDate: null,
  parentTaskItemId: null,
  childTaskCount: 0,
  moveCount: 0,
  daysTagged: 1,
  projectId: null,
  projectName: null,
}

let queryClient: QueryClient

function LocationDisplay() {
  const l = useLocation()
  return <div data-testid="location">{l.pathname + l.search}</div>
}

function page() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocationDisplay />
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const renderPage = () => render(page())
const useData = (data: unknown[]) =>
  vi.mocked(useTasksQuery).mockReturnValue({ data: { data }, isLoading: false, error: null } as never)
const rowFor = (title: string) => screen.getByText(title).closest('tr') as HTMLElement
const filterSelect = () => document.getElementById('project-filter') as HTMLSelectElement
const toggleOf = (key: string) => document.querySelector<HTMLElement>(`[data-section-toggle="${key}"]`) as HTMLElement
const sectionToggles = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-section-toggle]')).map(el => el.dataset.sectionToggle)

describe('TasksPage derived parent status (#385)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const mockPrefs: PrefsContextValue = {
      isDark: false,
      setIsDark: vi.fn(),
      theme: 'default',
      setTheme: vi.fn(),
      headerStyle: 'stat',
      setHeaderStyle: vi.fn(),
      todoSort: 'manual',
      setTodoSort: vi.fn(),
      projectStart: '2026-05-09',
      setProjectStart: vi.fn(),
      taskSortKey: 'title',
      setTaskSortKey: vi.fn(),
      taskSortDir: 'asc',
      setTaskSortDir: vi.fn(),
      autoCompleteParentWhenChildrenDone: false,
      setAutoCompleteParentWhenChildrenDone: vi.fn(),
      weekdaysOnly: false,
      setWeekdaysOnly: vi.fn(),
    }
    vi.mocked(usePrefs).mockReturnValue(mockPrefs)
    taskMutations.mutate.mockReset()
    taskMutations.mutateAsync.mockReset().mockResolvedValue({})
    vi.mocked(useCreateTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useUpdateTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useBlockTaskMutation).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.mocked(useUnblockTaskMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useEditBlockedReasonMutation).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.mocked(useChangeTaskProject).mockReturnValue({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useProjectsQuery).mockReturnValue({ data: { data: [] }, isSuccess: true } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Parent 1 is stored Todo; its only open child is In Progress, so the parent is In Progress and, when its
  // child is hidden by the status filter, still lands in the In Progress section.
  const family = (childStatus: string, parentStatus = 'Todo') => [
    { ...baseTask, id: 1, title: 'Parent', status: parentStatus, priority: 'High', blockedReason: 'Waiting on Sam' },
    { ...baseTask, id: 2, title: 'Child', status: childStatus, priority: 'High', parentTaskItemId: 1 },
  ]

  it('shows a header progress label with direct done and in-progress counts', () => {
    useData([
      ...family('InProgress'),
      { ...baseTask, id: 3, title: 'Done', status: 'Completed', priority: 'High', parentTaskItemId: 1 },
    ])
    renderPage()
    expect(screen.getByText('1 of 2 done · 1 in progress')).toBeInTheDocument()
  })

  it('omits the in-progress suffix when none are in progress', () => {
    useData(family('Todo'))
    renderPage()
    expect(screen.getByText('0 of 1 done')).toBeInTheDocument()
  })

  // The child sits in project 5 and the parent in none, so the "No project" filter hides the child only.
  const filteredChildFamily = () => [
    { ...baseTask, id: 1, title: 'Parent', status: 'Todo', priority: 'High', blockedReason: 'Stale reason' },
    { ...baseTask, id: 2, title: 'Child', status: 'InProgress', priority: 'High', parentTaskItemId: 1, projectId: 5 },
  ]
  const hideChildren = () => userEvent.selectOptions(filterSelect(), 'none')

  it('keeps a parent derived from its filtered-out child: section, status filter, locked badge', async () => {
    useData(filteredChildFamily())
    renderPage()
    await hideChildren()
    expect(screen.queryByText('Child')).not.toBeInTheDocument()
    expect(sectionToggles()).toEqual(['inProgress'])
    const parent = within(rowFor('Parent'))
    expect(parent.getByText('In Progress')).toHaveClass('t-badge-derived')
    expect(parent.getByText('In Progress')).toHaveAttribute('title', expect.stringContaining('1 open subtask.'))
    expect(parent.queryByRole('button', { name: /^Status:/ })).not.toBeInTheDocument()
    expect(parent.queryByRole('button', { name: /^Block task/ })).not.toBeInTheDocument()
    // The status filter applies to the derived status, not the stored To-do.
    await userEvent.click(screen.getByRole('checkbox', { name: 'In Progress' }))
    expect(screen.queryByText('Parent')).not.toBeInTheDocument()
  })

  it('hides the stored blocked reason on a locked work row', async () => {
    useData([
      { ...filteredChildFamily()[0], status: 'Blocked', blockedReason: 'Stale reason' },
      filteredChildFamily()[1],
    ])
    renderPage()
    await hideChildren()
    expect(screen.queryByText('Stale reason')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Unblock task/ })).not.toBeInTheDocument()
  })

  it('does not send a status change for a locked row', async () => {
    useData(filteredChildFamily())
    renderPage()
    await hideChildren()
    within(rowFor('Parent')).getByText('In Progress').click()
    expect(taskMutations.mutate).not.toHaveBeenCalled()
  })

  it('Edit on a locked parent navigates to the detail page in edit mode (the locked form is covered there)', async () => {
    useData(filteredChildFamily())
    renderPage()
    await hideChildren()
    await userEvent.click(within(rowFor('Parent')).getByRole('button', { name: 'Edit Parent' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks/1?edit=1')
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument()
  })

  it('counts a derived Blocked parent in the Blocked status total', () => {
    useData(family('Blocked', 'Todo'))
    renderPage()
    // Parent (derived Blocked) and child.
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('shows the stored status and reason again when every subtask is Completed', async () => {
    useData(family('Completed', 'Blocked'))
    renderPage()
    await userEvent.click(toggleOf('blocked'))
    expect(screen.getByRole('button', { name: 'Unblock task: Parent' })).toBeInTheDocument()
    expect(screen.getByText('Waiting on Sam')).toBeInTheDocument()
  })

  it('keeps the existing child progress text on rows', () => {
    useData([
      { ...baseTask, id: 1, title: 'Parent', status: 'Todo', priority: 'High' },
      { ...baseTask, id: 2, title: 'Child', status: 'Completed', priority: 'High', parentTaskItemId: 1 },
    ])
    renderPage()
    expect(within(screen.getByText('Parent').closest('tr') as HTMLElement).getByText('1/1 subtasks complete')).toBeInTheDocument()
  })
})
