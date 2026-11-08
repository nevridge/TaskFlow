import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
const searchBox = () => screen.getByPlaceholderText('Search title or #id…')

describe('TasksPage search by task ID (#423)', () => {
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
    vi.mocked(useProjectsQuery).mockReturnValue({
      data: {
        data: [
          { id: 1, name: 'Alpha', isArchived: false },
          { id: 2, name: 'Beta', isArchived: false },
        ],
      },
      isSuccess: true,
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const task = (id: number, title: string, extra: Record<string, unknown> = {}) =>
    ({ ...baseTask, id, title, status: 'Todo', priority: 'High', ...extra })

  const search = async (text: string) => {
    await userEvent.type(searchBox(), text)
  }

  it('uses the "Search title or #id…" placeholder', () => {
    useData([task(1, 'A')])
    renderPage()
    expect(searchBox()).toBeInTheDocument()
  })

  it.each(['42', '#42', '042', ' 42 '])('lists only task #42 for "%s"', async text => {
    useData([task(42, 'Fix login'), task(7, 'Other'), task(142, 'Hundred')])
    renderPage()
    await search(text)
    await waitFor(() => expect(screen.queryByText('Other')).not.toBeInTheDocument())
    expect(screen.getByText('Fix login')).toBeInTheDocument()
    expect(screen.queryByText('Hundred')).not.toBeInTheDocument()
    expect(screen.getByText('1 task')).toBeInTheDocument()
  })

  it('lists both the ID match and title matches containing the number', async () => {
    useData([task(42, 'Fix login'), task(7, 'Q3 plan 42'), task(8, 'Unrelated')])
    renderPage()
    await search('42')
    await waitFor(() => expect(screen.queryByText('Unrelated')).not.toBeInTheDocument())
    expect(screen.getByText('Fix login')).toBeInTheDocument()
    expect(screen.getByText('Q3 plan 42')).toBeInTheDocument()
    expect(screen.getByText('2 tasks')).toBeInTheDocument()
  })

  it('matches a title containing "#42" for typed "#42"', async () => {
    useData([task(7, 'See #42 notes'), task(8, 'Unrelated')])
    renderPage()
    await search('#42')
    await waitFor(() => expect(screen.queryByText('Unrelated')).not.toBeInTheDocument())
    expect(screen.getByText('See #42 notes')).toBeInTheDocument()
  })

  it('shows a subtask matched by ID under its parent context header, excluding the header from the count', async () => {
    useData([task(1, 'Parent plan'), task(42, 'Child step', { parentTaskItemId: 1 }), task(3, 'Unrelated')])
    renderPage()
    await search('42')
    await waitFor(() => expect(screen.queryByText('Unrelated')).not.toBeInTheDocument())
    expect(screen.getByText('Child step')).toBeInTheDocument()
    expect(screen.getByText('Parent plan').closest('tr')).toHaveClass('t-context-header')
    expect(screen.getByText('1 task')).toBeInTheDocument()
  })

  it('still matches text search and treats whitespace-only input as empty', async () => {
    useData([task(42, 'Fix login'), task(7, 'Other')])
    renderPage()
    await search('login')
    await waitFor(() => expect(screen.queryByText('Other')).not.toBeInTheDocument())
    await userEvent.clear(searchBox())
    await search('   ')
    await waitFor(() => expect(searchBox()).toHaveValue('   '))
    expect(await screen.findByText('Other')).toBeInTheDocument()
    expect(screen.getByText('Fix login')).toBeInTheDocument()
  })

  it('shows the empty state when no ID or title matches', async () => {
    useData([task(42, 'Fix login')])
    renderPage()
    await search('999')
    expect(await screen.findByText('No tasks match your filters.')).toBeInTheDocument()
  })

  it('does not override the status filter: Completed #42 needs Completed checked', async () => {
    useData([task(42, 'Done thing', { status: 'Completed' }), task(7, 'Open thing')])
    renderPage()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Completed' }))
    await search('42')
    expect(await screen.findByText('No tasks match your filters.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Completed' }))
    expect(await screen.findByText('1 task')).toBeInTheDocument()
  })

  it('does not override the project filter', async () => {
    useData([task(42, 'Beta thing', { projectId: 2, projectName: 'Beta' }), task(7, 'Alpha thing', { projectId: 1, projectName: 'Alpha' })])
    renderPage()
    await userEvent.selectOptions(document.getElementById('project-filter') as HTMLSelectElement, 'Alpha')
    await search('42')
    expect(await screen.findByText('No tasks match your filters.')).toBeInTheDocument()
  })

  it('does not override the view chip filter', async () => {
    useData([task(42, 'Finished', { status: 'Completed' }), task(7, 'Open thing')])
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Active today' }))
    await search('42')
    expect(await screen.findByText('No tasks match your filters.')).toBeInTheDocument()
  })
})
