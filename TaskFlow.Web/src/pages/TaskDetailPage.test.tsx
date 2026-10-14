import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { PrefsContextValue } from '@/context/PrefsContextDef'

vi.mock('@/hooks/useTasks', () => ({
  useTaskQuery: vi.fn(),
  useTasksQuery: vi.fn(),
  useUpdateTaskMutation: vi.fn(),
  useDeleteTaskMutation: vi.fn(),
  useTaskHistoryQuery: vi.fn(),
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

vi.mock('@/hooks/useNotes', () => ({
  useNotesQuery: vi.fn(),
  useCreateNoteMutation: vi.fn(),
  useUpdateNoteMutation: vi.fn(),
  useDeleteNoteMutation: vi.fn(),
}))

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel" />,
}))

import { useTaskQuery, useTasksQuery, useUpdateTaskMutation, useDeleteTaskMutation, useTaskHistoryQuery } from '@/hooks/useTasks'
import { useProjectsQuery, useChangeTaskProject } from '@/hooks/useProjects'
import { useNotesQuery, useCreateNoteMutation, useUpdateNoteMutation, useDeleteNoteMutation } from '@/hooks/useNotes'
import { usePrefs } from '@/context/usePrefs'
import { TaskDetailPage } from './TaskDetailPage'

const task = {
  id: 1,
  title: 'Fix login bug',
  description: 'Users cannot log in',
  status: 'Todo',
  priority: 'Low',
  isComplete: false,
  dueDate: null,
  parentTaskItemId: null,
  childTaskCount: 0,
  currentJournalDate: null,
  moveCount: 0,
  daysTagged: 0,
}

const projects = [
  { id: 1, name: 'Alpha', isArchived: false },
  { id: 2, name: 'Beta', isArchived: false },
  { id: 3, name: 'Old', isArchived: true },
]

function makePrefs(overrides?: Partial<PrefsContextValue>): PrefsContextValue {
  return {
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
    ...overrides,
  }
}

let queryClient: QueryClient

function renderPage(path = '/tasks/1') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const updateAsync = vi.fn()
const changeAsync = vi.fn()
const changeMutate = vi.fn()

function mockChange(overrides: Record<string, unknown> = {}) {
  vi.mocked(useChangeTaskProject).mockReturnValue({
    mutate: changeMutate,
    mutateAsync: changeAsync,
    isPending: false,
    ...overrides,
  } as never)
}

function mockTask(overrides: Record<string, unknown> = {}) {
  vi.mocked(useTaskQuery).mockReturnValue({
    data: { data: { ...task, ...overrides } },
    isLoading: false,
    error: null,
  } as never)
}

let confirmSpy: ReturnType<typeof vi.spyOn>

describe('TaskDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    updateAsync.mockReset().mockResolvedValue({})
    changeAsync.mockReset().mockResolvedValue(undefined)
    changeMutate.mockReset()

    vi.mocked(usePrefs).mockReturnValue(makePrefs())
    vi.mocked(useProjectsQuery).mockReturnValue({ data: { data: projects }, isSuccess: true } as never)
    mockChange()

    vi.mocked(useTaskQuery).mockReturnValue({ data: { data: task }, isLoading: false, error: null } as never)
    vi.mocked(useTasksQuery).mockReturnValue({ data: { data: [task] }, isLoading: false } as never)
    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(useTaskHistoryQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)

    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutate: vi.fn(), mutateAsync: updateAsync, isPending: false } as never)
    vi.mocked(useDeleteTaskMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useCreateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useUpdateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useDeleteNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)

    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    confirmSpy.mockRestore()
  })

  it('shows loading state', () => {
    vi.mocked(useTaskQuery).mockReturnValue({ data: undefined, isLoading: true, error: null } as never)
    renderPage()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows error state when task fetch fails', () => {
    vi.mocked(useTaskQuery).mockReturnValue({ data: undefined, isLoading: false, error: new Error('not found') } as never)
    renderPage()
    expect(screen.getByText(/task not found/i)).toBeInTheDocument()
  })

  it('shows Task not found for non-numeric id', () => {
    renderPage('/tasks/abc')
    expect(screen.getByText(/task not found/i)).toBeInTheDocument()
  })

  it('renders task title', () => {
    renderPage()
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
  })

  it('status badge shows lowercased status', () => {
    renderPage()
    expect(screen.getByText('todo')).toBeInTheDocument()
  })

  it('priority badge shows lowercased priority', () => {
    renderPage()
    expect(screen.getByText('low')).toBeInTheDocument()
  })

  it('description text is visible when present', () => {
    renderPage()
    expect(screen.getByText('Users cannot log in')).toBeInTheDocument()
  })

  it('description is absent when null', () => {
    mockTask({ description: null })
    renderPage()
    expect(screen.queryByText('Users cannot log in')).not.toBeInTheDocument()
  })

  it('renders history panel', () => {
    renderPage()
    expect(screen.getByTestId('history-panel')).toBeInTheDocument()
  })

  it('renders back link', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /back to tasks/i })).toBeInTheDocument()
  })

  it('edit button renders TaskForm with pre-populated title', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement
    expect(titleInput).toBeInTheDocument()
    expect(titleInput.value).toBe('Fix login bug')
  })

  it('cancel in edit form returns to view mode', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument()
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
  })

  it('submitting edit form calls the update mutation with the task fields and closes the form', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(updateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, data: expect.objectContaining({ title: 'Fix login bug' }) }),
    )
    await waitFor(() => expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument())
  })

  it('delete with confirm=true calls deleteTask.mutate', async () => {
    const deleteMutate = vi.fn()
    vi.mocked(useDeleteTaskMutation).mockReturnValue({ mutate: deleteMutate, isPending: false } as never)
    confirmSpy.mockReturnValue(true)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(deleteMutate).toHaveBeenCalledWith(1, expect.any(Object))
  })

  it('delete with confirm=false does not call deleteTask.mutate', async () => {
    const deleteMutate = vi.fn()
    vi.mocked(useDeleteTaskMutation).mockReturnValue({ mutate: deleteMutate, isPending: false } as never)
    confirmSpy.mockReturnValue(false)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(deleteMutate).not.toHaveBeenCalled()
  })

  it('shows "No notes yet" when notes are empty', () => {
    renderPage()
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
  })

  it('Add Note button shows NoteForm', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /add note/i }))
    // NoteForm renders a textarea or input for note content
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  async function saveWithUpdateError(error: unknown) {
    updateAsync.mockRejectedValue(error)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
  }

  it('TASK_REOPEN_PAST_DAY_NOT_ALLOWED error shows proper message', async () => {
    await saveWithUpdateError({ code: 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED' })
    expect(await screen.findByText(/completed tasks assigned to past days cannot be reopened/i)).toBeInTheDocument()
  })

  it('TASK_PARENT_CYCLE_NOT_ALLOWED error shows proper message', async () => {
    await saveWithUpdateError({ code: 'TASK_PARENT_CYCLE_NOT_ALLOWED' })
    expect(await screen.findByText(/cycle/i)).toBeInTheDocument()
  })

  it('unknown mutation error shows generic message in an alert', async () => {
    await saveWithUpdateError({ code: 'UNKNOWN_ERROR' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/unable to save task changes/i)
  })

  it('PUT failure makes no project call and keeps the form open', async () => {
    mockTask({ projectId: 1, projectName: 'Alpha' })
    updateAsync.mockRejectedValue({ code: 'UNKNOWN_ERROR' })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Beta')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByRole('alert')
    expect(changeAsync).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument()
  })

  describe('project', () => {
    it('shows the project name of the task', () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      expect(screen.getByRole('combobox', { name: /project/i })).toHaveDisplayValue('Alpha')
    })

    it('shows "No project" when the task has no project (null) without error', () => {
      mockTask({ projectId: null, projectName: null })
      renderPage()
      expect(screen.getByRole('combobox', { name: /project/i })).toHaveDisplayValue('No project')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows "No project" when projectId and projectName are undefined', () => {
      renderPage()
      expect(screen.getByRole('combobox', { name: /project/i })).toHaveDisplayValue('No project')
    })

    it('shows an archived current project with the (archived) suffix', () => {
      mockTask({ projectId: 3, projectName: 'Old' })
      renderPage()
      expect(screen.getByRole('combobox', { name: /project/i })).toHaveDisplayValue('Old (archived)')
    })

    it('does not offer other archived projects; falls back to projectName when missing from the list', () => {
      // The list contains an archived project (Old) that is not the task's current one.
      vi.mocked(useProjectsQuery).mockReturnValue({ data: { data: [projects[0], projects[2]] }, isSuccess: true } as never)
      mockTask({ projectId: 9, projectName: 'Deleted elsewhere' })
      renderPage()
      const select = screen.getByRole('combobox', { name: /project/i })
      expect(select).toHaveDisplayValue('Deleted elsewhere')
      expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual([
        'No project',
        'Deleted elsewhere',
        'Alpha',
      ])
    })

    it('matches a string projectId against the options', () => {
      mockTask({ projectId: '2', projectName: 'Beta' })
      renderPage()
      expect(screen.getByRole('combobox', { name: /project/i })).toHaveDisplayValue('Beta')
    })

    it('quick change fires the mutation immediately and shows the new value optimistically', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      const select = screen.getByRole('combobox', { name: /project/i })
      await userEvent.selectOptions(select, 'Beta')
      expect(changeMutate).toHaveBeenCalledWith(
        { taskId: 1, fromProjectId: 1, toProjectId: 2 },
        expect.any(Object),
      )
      expect(select).toHaveDisplayValue('Beta')
      expect(updateAsync).not.toHaveBeenCalled()
    })

    it('quick change back to the original project still fires while the task has not refetched', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      const select = screen.getByRole('combobox', { name: /project/i })
      await userEvent.selectOptions(select, 'Beta')
      await userEvent.selectOptions(select, 'Alpha')
      expect(changeMutate).toHaveBeenLastCalledWith(
        { taskId: 1, fromProjectId: 2, toProjectId: 1 },
        expect.any(Object),
      )
      expect(select).toHaveDisplayValue('Alpha')
    })

    it('quick change on a task without a project assigns it (from null)', async () => {
      mockTask({ projectId: null, projectName: null })
      renderPage()
      await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'Alpha')
      expect(changeMutate).toHaveBeenCalledWith(
        { taskId: 1, fromProjectId: null, toProjectId: 1 },
        expect.any(Object),
      )
    })

    it('the quick-change select never offers archived projects other than the current one', () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      const labels = within(screen.getByRole('combobox', { name: /project/i }))
        .getAllByRole('option')
        .map(o => o.textContent)
      expect(labels).toEqual(['No project', 'Alpha', 'Beta'])
    })

    it('quick change restores focus to the select once the change settles', async () => {
      changeMutate.mockImplementation(() => { (document.activeElement as HTMLElement | null)?.blur() })
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'Beta')
      await waitFor(() => expect(screen.getByRole('combobox', { name: /project/i })).toHaveFocus())
    })

    it('quick change to "No project" unassigns', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'No project')
      expect(changeMutate).toHaveBeenCalledWith(
        { taskId: 1, fromProjectId: 1, toProjectId: null },
        expect.any(Object),
      )
    })

    it('select is disabled and busy while the change is in flight', () => {
      mockChange({ isPending: true })
      renderPage()
      const select = screen.getByRole('combobox', { name: /project/i })
      expect(select).toBeDisabled()
      expect(select).toHaveAttribute('aria-busy', 'true')
    })

    it('quick change error reverts the value, announces the message and refocuses the select', async () => {
      changeMutate.mockImplementation((_input, { onError }: { onError: (e: unknown) => void }) => onError({ status: 404 }))
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      const select = screen.getByRole('combobox', { name: /project/i })
      await userEvent.selectOptions(select, 'Beta')
      expect(await screen.findByRole('alert')).toHaveTextContent('The task or project could not be found. It may have been changed or removed.')
      expect(select).toHaveDisplayValue('Alpha')
      expect(select).toHaveFocus()
    })

    it('quick change maps a 409 conflict message', async () => {
      changeMutate.mockImplementation((_input, { onError }: { onError: (e: unknown) => void }) =>
        onError({ message: 'This task is already assigned to the project.' }))
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'Beta')
      expect(await screen.findByRole('alert')).toHaveTextContent('This task is already in that project.')
    })

    it('quick select is not rendered while the edit form is open', async () => {
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      expect(screen.getAllByRole('combobox', { name: /project/i })).toHaveLength(1)
      expect(document.getElementById('task-project')).toBeNull()
      expect(document.getElementById('projectId')).not.toBeNull()
    })

    it('edit form: unchanged project makes no project call and the PUT has no projectId', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      await userEvent.clear(screen.getByLabelText(/title/i))
      await userEvent.type(screen.getByLabelText(/title/i), 'Renamed')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() => expect(updateAsync).toHaveBeenCalled())
      expect(updateAsync.mock.calls[0][0].data).not.toHaveProperty('projectId')
      expect(changeAsync).not.toHaveBeenCalled()
    })

    it('edit form: moving to another project assigns it (never unassigns first)', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Beta')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() =>
        expect(changeAsync).toHaveBeenCalledWith({ taskId: 1, fromProjectId: 1, toProjectId: 2 }),
      )
      expect(updateAsync.mock.calls[0][0].data).not.toHaveProperty('projectId')
    })

    it('edit form: "No project" unassigns from the old project', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'No project')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() =>
        expect(changeAsync).toHaveBeenCalledWith({ taskId: 1, fromProjectId: 1, toProjectId: null }),
      )
    })

    it('partial failure keeps the form open and focus on Save; a retry re-sends PUT then the project call', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      changeAsync.mockRejectedValueOnce({ message: 'boom' })
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Beta')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Task saved, but the project change failed: Unable to change the project. Please try again.',
      )
      expect(screen.getByLabelText(/title/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save/i })).toHaveFocus()

      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() => expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument())
      expect(updateAsync).toHaveBeenCalledTimes(2)
      expect(changeAsync).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('button', { name: /edit/i })).toHaveFocus()
    })

    it('partial failure invalidates the task list and detail queries', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      changeAsync.mockRejectedValueOnce({ message: 'boom' })
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Beta')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await screen.findByRole('alert')
      const keys = invalidate.mock.calls.map(c => c[0]?.queryKey)
      expect(keys).toContainEqual(['tasks'])
      expect(keys).toContainEqual(['tasks', 1])
    })

    it('a 404 on the project call marks the Project select invalid and focuses it until changed', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      changeAsync.mockRejectedValueOnce({ status: 404 })
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      const select = screen.getByRole('combobox', { name: 'Project' })
      await userEvent.selectOptions(select, 'Beta')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent('The task or project could not be found. It may have been changed or removed.')
      expect(select).toHaveAttribute('aria-invalid', 'true')
      expect(select).toHaveFocus()
      await userEvent.selectOptions(select, 'Alpha')
      expect(select).not.toHaveAttribute('aria-invalid')
    })
  })
})
