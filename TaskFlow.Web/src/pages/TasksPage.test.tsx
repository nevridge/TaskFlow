import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { TasksPage } from './TasksPage'

vi.mock('@/hooks/useTasks', () => ({
  useTasksQuery: vi.fn(),
  useCreateTaskMutation: vi.fn(),
  useUpdateTaskMutation: vi.fn(),
  useDeleteTaskMutation: vi.fn(),
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

vi.mock('@/hooks/useJournal', () => ({
  useJournalEntries: vi.fn(),
}))

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(),
}))

import { useTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from '@/hooks/useTasks'
import { useProjectsQuery, useChangeTaskProject } from '@/hooks/useProjects'
import { useJournalEntries } from '@/hooks/useJournal'
import { usePrefs } from '@/context/usePrefs'
import type { PrefsContextValue } from '@/context/PrefsContextDef'

const taskMutations = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
}
const changeAsync = vi.fn()

const baseTask = {
  description: null,
  priority: 'Low',
  isComplete: false,
  dueDate: null,
  parentTaskItemId: null,
  childTaskCount: 0,
  moveCount: 0,
  daysTagged: 1,
  projectId: null,
  projectName: null,
}

const taskList = [
  {
    ...baseTask,
    id: 1,
    title: 'Parent task',
    status: 'Todo',
    childTaskCount: 1,
    currentJournalDate: '2026-05-16',
  },
  {
    ...baseTask,
    id: 2,
    title: 'Child task',
    status: 'Todo',
    parentTaskItemId: 1,
    currentJournalDate: '2026-05-16',
  },
  {
    ...baseTask,
    id: 3,
    title: 'Alpha work',
    status: 'Todo',
    projectId: 1,
    projectName: 'Alpha',
    currentJournalDate: '2999-01-01',
  },
  {
    ...baseTask,
    id: 4,
    title: 'Beta finished',
    status: 'Completed',
    isComplete: true,
    // The generated client types projectId as number | string | null
    projectId: '2',
    projectName: 'Beta',
    currentJournalDate: null,
  },
  {
    ...baseTask,
    id: 5,
    title: 'Legacy chore',
    status: 'Todo',
    projectId: 3,
    projectName: 'Old',
    currentJournalDate: null,
  },
]

const projectList = [
  { id: 1, name: 'Alpha', isArchived: false },
  { id: 2, name: 'Beta', isArchived: false },
  { id: 3, name: 'Old', isArchived: true },
]

function mockProjects(projects: typeof projectList | undefined, state: { isSuccess?: boolean } = {}) {
  vi.mocked(useProjectsQuery).mockReturnValue({
    data: projects ? { data: projects } : undefined,
    isSuccess: state.isSuccess ?? projects !== undefined,
  } as never)
}

function page() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

let queryClient: QueryClient

function renderPage() {
  return render(page())
}

function filterSelect() {
  return document.getElementById('project-filter') as HTMLSelectElement
}

function rowFor(title: string) {
  return screen.getByText(title).closest('tr') as HTMLElement
}

describe('TasksPage', () => {
  beforeEach(() => {
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
    changeAsync.mockReset().mockResolvedValue(undefined)
    vi.mocked(useCreateTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useUpdateTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useDeleteTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useChangeTaskProject).mockReturnValue({ mutateAsync: changeAsync, mutate: vi.fn(), isPending: false } as never)
    mockProjects(projectList)

    vi.mocked(useJournalEntries).mockReturnValue({
      data: {
        data: [{ id: 10, date: '2026-05-16', todoTaskItemIds: [1, 2] }],
      },
      isLoading: false,
      error: null,
    } as never)

    vi.mocked(useTasksQuery).mockReturnValue({
      data: { data: taskList },
      isLoading: false,
      error: null,
    } as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders hierarchical tasks without maximum update depth warnings', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderPage()

    expect(screen.getByText('Parent task')).toBeInTheDocument()
    expect(screen.getByText('Child task')).toBeInTheDocument()

    const maxDepthWarningSeen = errorSpy.mock.calls.some(call =>
      call.some(arg => String(arg).includes('Maximum update depth exceeded')),
    )
    expect(maxDepthWarningSeen).toBe(false)

    errorSpy.mockRestore()
  })

  it('toggles subtask visibility when parent row is collapsed and expanded', async () => {
    renderPage()

    expect(screen.getByText('Child task')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Hide subtasks' }))
    expect(screen.queryByText('Child task')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show subtasks' }))
    expect(screen.getByText('Child task')).toBeInTheDocument()
  })

  describe('project badge', () => {
    it('shows the project name on rows that have one and nothing on rows without', () => {
      renderPage()
      expect(within(rowFor('Alpha work')).getByText('Alpha')).toBeInTheDocument()
      expect(rowFor('Parent task').querySelector('.t-badge-project')).toBeNull()
    })
  })

  describe('project filter', () => {
    it('lists All projects, No project, active projects, then archived projects with a suffix', () => {
      renderPage()
      const labels = within(filterSelect()).getAllByRole('option').map(o => o.textContent)
      expect(labels).toEqual(['All projects', 'No project', 'Alpha', 'Beta', 'Old (archived)'])
      expect(screen.getByRole('combobox', { name: 'Project' })).toBe(filterSelect())
    })

    it('puts the project select after the status select', () => {
      renderPage()
      const status = screen.getByRole('combobox', { name: 'Status' })
      expect(status.compareDocumentPosition(filterSelect()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('tab order in the filter row is Status then Project', async () => {
      renderPage()
      screen.getByRole('combobox', { name: 'Status' }).focus()
      await userEvent.tab()
      expect(filterSelect()).toHaveFocus()
    })

    it('updates the filtered list and count when a task project changes without a reload', async () => {
      const { rerender } = renderPage()
      await userEvent.selectOptions(filterSelect(), 'Alpha')
      expect(screen.getByText('Alpha work')).toBeInTheDocument()
      expect(screen.getByText('1 task')).toBeInTheDocument()

      vi.mocked(useTasksQuery).mockReturnValue({
        data: { data: taskList.map(t => (t.id === 3 ? { ...t, projectId: 2, projectName: 'Beta' } : t)) },
        isLoading: false,
        error: null,
      } as never)
      rerender(page())

      expect(screen.queryByText('Alpha work')).not.toBeInTheDocument()
      expect(screen.getByText('No tasks match your filters.')).toBeInTheDocument()
      await userEvent.selectOptions(filterSelect(), 'Beta')
      expect(screen.getByText('Alpha work')).toBeInTheDocument()
      expect(screen.getByText('2 tasks')).toBeInTheDocument()
    })

    it('shows only the selected project tasks, matching a string projectId by number', async () => {
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'Beta')
      expect(screen.getByText('Beta finished')).toBeInTheDocument()
      expect(screen.queryByText('Alpha work')).not.toBeInTheDocument()
      expect(screen.queryByText('Parent task')).not.toBeInTheDocument()
      expect(screen.getByText('1 task')).toBeInTheDocument()
    })

    it('can filter by an archived project', async () => {
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'Old (archived)')
      expect(screen.getByText('Legacy chore')).toBeInTheDocument()
      expect(screen.queryByText('Alpha work')).not.toBeInTheDocument()
    })

    it('"No project" shows only unassigned tasks', async () => {
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'No project')
      expect(screen.getByText('Parent task')).toBeInTheDocument()
      expect(screen.queryByText('Alpha work')).not.toBeInTheDocument()
      expect(screen.queryByText('Beta finished')).not.toBeInTheDocument()
      expect(screen.queryByText('Legacy chore')).not.toBeInTheDocument()
    })

    it('treats a task with undefined projectId as unassigned', async () => {
      vi.mocked(useTasksQuery).mockReturnValue({
        data: { data: [{ id: 9, title: 'Bare task', status: 'Todo', priority: 'Low' }] },
        isLoading: false,
        error: null,
      } as never)
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'No project')
      expect(screen.getByText('Bare task')).toBeInTheDocument()
    })

    it('composes with the status filter', async () => {
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'Beta')
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Todo')
      expect(screen.queryByText('Beta finished')).not.toBeInTheDocument()
      expect(screen.getByText('No tasks match your filters.')).toBeInTheDocument()
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Completed')
      expect(screen.getByText('Beta finished')).toBeInTheDocument()
    })

    it('composes with the view filter', async () => {
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'Scheduled future' }))
      expect(screen.getByText('Alpha work')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Active today' }))
      expect(screen.queryByText('Alpha work')).not.toBeInTheDocument()
      expect(screen.getByText('No tasks match your filters.')).toBeInTheDocument()
    })

    it('composes with search', async () => {
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'No project')
      await userEvent.type(screen.getByPlaceholderText('Search tasks...'), 'Child')
      await waitFor(() => expect(screen.queryByText('Parent task')).not.toBeInTheDocument())
      expect(screen.getByText('Child task')).toBeInTheDocument()
      expect(screen.queryByText('Alpha work')).not.toBeInTheDocument()
    })

    it('resets a stale filter to All when the project disappears after a successful load', async () => {
      const { rerender } = renderPage()
      await userEvent.selectOptions(filterSelect(), 'Alpha')
      expect(screen.queryByText('Parent task')).not.toBeInTheDocument()
      mockProjects(projectList.filter(p => p.id !== 1))
      rerender(page())
      await waitFor(() => expect(filterSelect()).toHaveDisplayValue('All projects'))
      expect(screen.getByText('Parent task')).toBeInTheDocument()
    })

    it('after a stale reset the create form does not default to the removed project and the filter stays All if it reappears', async () => {
      const { rerender } = renderPage()
      await userEvent.selectOptions(filterSelect(), 'Alpha')
      mockProjects(projectList.filter(p => p.id !== 1))
      rerender(page())
      await waitFor(() => expect(filterSelect()).toHaveDisplayValue('All projects'))
      await userEvent.click(screen.getByRole('button', { name: 'New Task' }))
      expect(document.getElementById('projectId')).toHaveDisplayValue('No project')
      mockProjects(projectList)
      rerender(page())
      expect(filterSelect()).toHaveDisplayValue('All projects')
    })

    it('does not reset the filter while projects are loading or when the fetch failed', async () => {
      const { rerender } = renderPage()
      await userEvent.selectOptions(filterSelect(), 'Alpha')
      mockProjects(undefined, { isSuccess: false })
      rerender(page())
      expect(screen.getByText('Alpha work')).toBeInTheDocument()
      expect(screen.queryByText('Parent task')).not.toBeInTheDocument()
      mockProjects(projectList)
      rerender(page())
      expect(filterSelect()).toHaveDisplayValue('Alpha')
    })
  })

  describe('create and edit forms', () => {
    it('create passes the chosen projectId to the create mutation', async () => {
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: 'New Task' }))
      await userEvent.type(screen.getByLabelText('Title'), 'Brand new')
      const select = document.getElementById('projectId') as HTMLSelectElement
      await userEvent.selectOptions(select, 'Beta')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(taskMutations.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Brand new', projectId: 2 }),
        expect.any(Object),
      )
    })

    it('create preselects the filtered active project', async () => {
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'New Task' }))
      expect(document.getElementById('projectId')).toHaveDisplayValue('Alpha')
    })

    it('create does not preselect an archived filtered project', async () => {
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'Old (archived)')
      await userEvent.click(screen.getByRole('button', { name: 'New Task' }))
      expect(document.getElementById('projectId')).toHaveDisplayValue('No project')
    })

    it('create 422 TASK_PROJECT_NOT_FOUND shows the message, keeps the form and marks the select invalid', async () => {
      taskMutations.mutate.mockImplementation((_data, { onError }: { onError: (e: unknown) => void }) =>
        onError({ code: 'TASK_PROJECT_NOT_FOUND' }))
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: 'New Task' }))
      await userEvent.type(screen.getByLabelText('Title'), 'Keep me')
      await userEvent.selectOptions(document.getElementById('projectId') as HTMLSelectElement, 'Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('The selected project was not found.')
      expect(screen.getByLabelText('Title')).toHaveValue('Keep me')
      const select = document.getElementById('projectId') as HTMLSelectElement
      expect(select).toHaveAttribute('aria-invalid', 'true')
      expect(select).toHaveFocus()
      expect(taskMutations.mutate).toHaveBeenCalledTimes(1)
      await userEvent.selectOptions(select, 'Beta')
      expect(select).not.toHaveAttribute('aria-invalid')
    })

    it('create with a generic error shows the generic message', async () => {
      taskMutations.mutate.mockImplementation((_data, { onError }: { onError: (e: unknown) => void }) =>
        onError({ message: 'x' }))
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: 'New Task' }))
      await userEvent.type(screen.getByLabelText('Title'), 'T')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save task changes. Please try again.')
    })

    it('edit save runs PUT then the assign call and closes the form', async () => {
      renderPage()
      await userEvent.click(within(rowFor('Alpha work')).getByRole('button', { name: 'Edit' }))
      const select = document.getElementById('projectId') as HTMLSelectElement
      expect(select).toHaveDisplayValue('Alpha')
      await userEvent.selectOptions(select, 'Beta')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(changeAsync).toHaveBeenCalledWith({ taskId: 3, fromProjectId: 1, toProjectId: 2 }),
      )
      expect(taskMutations.mutateAsync.mock.calls[0][0].data).not.toHaveProperty('projectId')
      await waitFor(() => expect(screen.queryByText('Edit Task')).not.toBeInTheDocument())
    })

    it('edit save with an untouched project makes no project call', async () => {
      renderPage()
      await userEvent.click(within(rowFor('Beta finished')).getByRole('button', { name: 'Edit' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(taskMutations.mutateAsync).toHaveBeenCalled())
      expect(changeAsync).not.toHaveBeenCalled()
    })

    it('edit of a task in an archived project keeps it selected with the suffix', async () => {
      renderPage()
      await userEvent.click(within(rowFor('Legacy chore')).getByRole('button', { name: 'Edit' }))
      expect(document.getElementById('projectId')).toHaveDisplayValue('Old (archived)')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(taskMutations.mutateAsync).toHaveBeenCalled())
      expect(changeAsync).not.toHaveBeenCalled()
    })

    it('edit with a failed project call shows the partial failure message and keeps the form open', async () => {
      changeAsync.mockRejectedValueOnce({ message: 'This task is already assigned to the project.' })
      renderPage()
      await userEvent.click(within(rowFor('Alpha work')).getByRole('button', { name: 'Edit' }))
      await userEvent.selectOptions(document.getElementById('projectId') as HTMLSelectElement, 'Beta')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Task saved, but the project change failed: This task is already in that project.',
      )
      expect(screen.getByText('Edit Task')).toBeInTheDocument()
    })

    function withTask3Project(projectId: number, projectName: string) {
      vi.mocked(useTasksQuery).mockReturnValue({
        data: { data: taskList.map(t => (t.id === 3 ? { ...t, projectId, projectName } : t)) },
        isLoading: false,
        error: null,
      } as never)
    }

    it('after a 409 the refetched project reaches the form; the retry makes no further assign call and keeps edits', async () => {
      changeAsync.mockRejectedValueOnce({ message: 'This task is already assigned to the project.' })
      const view = renderPage()
      await userEvent.click(within(rowFor('Alpha work')).getByRole('button', { name: 'Edit' }))
      await userEvent.type(screen.getByLabelText('Title'), ' edited')
      await userEvent.selectOptions(document.getElementById('projectId') as HTMLSelectElement, 'Beta')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('This task is already in that project.')
      expect(changeAsync).toHaveBeenCalledTimes(1)

      // Another tab had already moved the task to Beta; the invalidation refetch reports it.
      withTask3Project(2, 'Beta')
      view.rerender(page())
      expect(document.getElementById('projectId')).toHaveDisplayValue('Beta')
      expect(screen.getByLabelText('Title')).toHaveValue('Alpha work edited')

      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(taskMutations.mutateAsync).toHaveBeenCalledTimes(2))
      expect(changeAsync).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.queryByText('Edit Task')).not.toBeInTheDocument())
    })

    it('a "No project" retry after a refetch unassigns from the refetched project, not the stale one', async () => {
      changeAsync.mockRejectedValueOnce({ status: 404 })
      const view = renderPage()
      await userEvent.click(within(rowFor('Alpha work')).getByRole('button', { name: 'Edit' }))
      await userEvent.selectOptions(document.getElementById('projectId') as HTMLSelectElement, 'No project')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await screen.findByRole('alert')
      expect(changeAsync).toHaveBeenLastCalledWith({ taskId: 3, fromProjectId: 1, toProjectId: null })

      withTask3Project(2, 'Beta')
      view.rerender(page())
      // The selection follows the server; the user chooses "No project" again and retries.
      await userEvent.selectOptions(document.getElementById('projectId') as HTMLSelectElement, 'No project')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(changeAsync).toHaveBeenCalledTimes(2))
      expect(changeAsync).toHaveBeenLastCalledWith({ taskId: 3, fromProjectId: 2, toProjectId: null })
    })

    it('edit with a failed PUT makes no project call', async () => {
      taskMutations.mutateAsync.mockRejectedValueOnce({ code: 'UNKNOWN' })
      renderPage()
      await userEvent.click(within(rowFor('Alpha work')).getByRole('button', { name: 'Edit' }))
      await userEvent.selectOptions(document.getElementById('projectId') as HTMLSelectElement, 'Beta')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save task changes.')
      expect(changeAsync).not.toHaveBeenCalled()
    })
  })
})
