import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useGlobalKeyboardShortcuts } from '@/hooks/useGlobalKeyboardShortcuts'
import { useJournalKeyboardShortcuts } from '@/hooks/useJournalKeyboardShortcuts'
import type { PrefsContextValue } from '@/context/PrefsContextDef'

vi.mock('@/hooks/useTasks', () => ({
  useTaskQuery: vi.fn(),
  useTasksQuery: vi.fn(),
  useUpdateTaskMutation: vi.fn(),
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
}))

vi.mock('@/hooks/useDeleteTaskUndoable', () => ({
  useDeleteTaskUndoable: vi.fn(),
  useDeleteNoteUndoable: vi.fn(),
}))

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel" />,
}))

import { useTaskQuery, useTasksQuery, useUpdateTaskMutation, useTaskHistoryQuery } from '@/hooks/useTasks'
import { useDeleteTaskUndoable, useDeleteNoteUndoable } from '@/hooks/useDeleteTaskUndoable'
import { useProjectsQuery, useChangeTaskProject } from '@/hooks/useProjects'
import { useNotesQuery, useCreateNoteMutation, useUpdateNoteMutation } from '@/hooks/useNotes'
import { usePrefs } from '@/context/usePrefs'
import { TaskDetailPage } from './TaskDetailPage'
import { __resetCoarsePointerCache } from '@/lib/pointer'

const task = {
  id: 1,
  title: 'Fix login bug',
  description: 'Users cannot log in',
  status: 'Todo',
  priority: 'Low',
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

const deleteTask = vi.fn()
const deleteNote = vi.fn()

/** Stands in for the /tasks route: shows where the delete navigated to and with which state. */
function TasksProbe() {
  const location = useLocation()
  return <div data-testid="tasks-route" data-state={JSON.stringify(location.state)}>Tasks list</div>
}

function renderPage(path: string | { pathname: string; state?: unknown } = '/tasks/1') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/tasks" element={<TasksProbe />} />
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
    vi.mocked(useDeleteTaskUndoable).mockReturnValue(deleteTask)
    vi.mocked(useCreateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useUpdateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useDeleteNoteUndoable).mockReturnValue(deleteNote)

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

  it('status badge shows the status label', () => {
    renderPage()
    expect(screen.getAllByText('To-do')).toHaveLength(2)
  })

  it('shows the In Progress label and the local start time when startedAt is set', () => {
    mockTask({ status: 'InProgress', startedAt: '2026-05-01T08:00:00Z' })
    renderPage()
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0)
    expect(screen.getByText(/Started:/)).toBeInTheDocument()
    expect(screen.getByText(/2026/, { selector: 'strong' })).toBeInTheDocument()
  })

  it('renders nothing for startedAt when it is null', () => {
    mockTask({ status: 'Completed', startedAt: null })
    renderPage()
    expect(screen.queryByText(/Started:/)).not.toBeInTheDocument()
  })

  it('shows "Due:" followed by an em dash when there is no due date', () => {
    renderPage()
    const strong = screen.getByText('—', { selector: 'strong' })
    expect(strong.parentElement).toHaveTextContent('Due: —')
  })

  it('shows the due date as the picked calendar day', () => {
    mockTask({ dueDate: '2026-05-01' })
    renderPage()
    expect(screen.getByText('May 1, 2026', { selector: 'strong' })).toBeInTheDocument()
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

  describe('back link origin (#404)', () => {
    const backLink = () => screen.getByRole('link', { name: /^← Back to/ })

    it('returns to the journal day it came from, on the first render, passing the focus id', () => {
      renderPage({ pathname: '/tasks/1', state: { from: '/journal/11-07-2026', focusTaskId: 1 } })
      expect(backLink()).toHaveTextContent('← Back to Journal')
      expect(backLink()).toHaveAttribute('href', '/journal/11-07-2026')
    })

    it('keeps the journal back link when the same history state is rendered again (refresh)', () => {
      const { rerender } = renderPage({ pathname: '/tasks/1', state: { from: '/journal/11-07-2026' } })
      rerender(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[{ pathname: '/tasks/1', state: { from: '/journal/11-07-2026' } }]}>
            <Routes>
              <Route path="/tasks/:id" element={<TaskDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      )
      expect(backLink()).toHaveAttribute('href', '/journal/11-07-2026')
    })

    it.each([
      ['a non-journal path', '/tasks'],
      ['an absolute url', 'https://evil.example'],
      ['a protocol-relative url', '//evil'],
      ['a double slash', '/journal//x'],
      ['a backslash', '/journal/\\x'],
      ['a colon', '/journal/a:b'],
      ['an empty string', ''],
      ['a number', 42],
      ['null', null],
    ])('falls back to the Tasks list when from is %s', (_label, from) => {
      renderPage({ pathname: '/tasks/1', state: { from } })
      expect(backLink()).toHaveTextContent('← Back to Tasks')
      expect(backLink()).toHaveAttribute('href', '/tasks')
    })

    function JournalProbe() {
      const location = useLocation()
      return <div data-testid="journal-route" data-path={location.pathname} data-state={JSON.stringify(location.state)} />
    }
    function renderWithJournalRoute(state: unknown) {
      return render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[{ pathname: '/tasks/1', state }]}>
            <Routes>
              <Route path="/tasks/:id" element={<TaskDetailPage />} />
              <Route path="/journal/:date" element={<JournalProbe />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      )
    }

    it('clicking the journal back link lands on that day and hands back the incoming focus id', async () => {
      renderWithJournalRoute({ from: '/journal/11-07-2026', focusTaskId: 7 })
      await userEvent.click(backLink())
      const route = screen.getByTestId('journal-route')
      expect(route).toHaveAttribute('data-path', '/journal/11-07-2026')
      expect(JSON.parse(route.getAttribute('data-state') ?? 'null')).toEqual({ focusTaskId: 7 })
    })

    it('hands back the route task id when only from was supplied (context header link)', async () => {
      renderWithJournalRoute({ from: '/journal/11-07-2026' })
      await userEvent.click(backLink())
      expect(JSON.parse(screen.getByTestId('journal-route').getAttribute('data-state') ?? 'null')).toEqual({ focusTaskId: 1 })
    })

    it('falls back to the Tasks list with no state (direct load)', () => {
      renderPage()
      expect(backLink()).toHaveAttribute('href', '/tasks')
    })
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

  it('Delete starts an undoable delete and navigates to /tasks at once, with no confirm (AC8)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /delete task/i }))
    expect(deleteTask).toHaveBeenCalledWith({ id: 1, title: 'Fix login bug' }, expect.any(Function))
    expect(confirmSpy).not.toHaveBeenCalled()
    const route = screen.getByTestId('tasks-route')
    expect(route).toHaveAttribute('data-state', JSON.stringify({ focusNewTask: true }))
    confirmSpy.mockRestore()
  })

  it('shows an empty shell, not "Task not found", while leaving after a self-initiated delete', async () => {
    // The pending filter makes the task disappear in the same render as the click.
    deleteTask.mockImplementation(() => {
      vi.mocked(useTaskQuery).mockReturnValue({ data: undefined, isLoading: false, error: null } as never)
    })
    const seen: string[] = []
    const observer = new MutationObserver(() => seen.push(document.body.textContent ?? ''))
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /delete task/i }))
    observer.disconnect()
    expect(seen.some(text => text.includes('Task not found'))).toBe(false)
  })

  it('a direct visit to a missing task still shows "Task not found."', () => {
    vi.mocked(useTaskQuery).mockReturnValue({ data: undefined, isLoading: false, error: null } as never)
    renderPage()
    expect(screen.getByText('Task not found.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
  })

  describe('parent task with subtasks (AC14, AC15)', () => {
    beforeEach(() => mockTask({ childTaskCount: 2 }))

    it('Delete is aria-disabled, focusable and described by a visible hint below the title row', () => {
      const { container } = renderPage()
      const btn = screen.getByRole('button', { name: 'Delete task' })
      expect(btn).toHaveAttribute('aria-disabled', 'true')
      expect(btn).not.toBeDisabled()
      expect(btn).toHaveAccessibleDescription('Delete subtasks first (2)')
      const hint = screen.getByText('Delete subtasks first (2)')
      expect(hint).toBeVisible()
      expect(hint.closest('.t-card-actions')).toBeNull()
      expect(hint.previousElementSibling).toHaveClass('t-card-row')
      expect(container.querySelector('.sr-only')).toBeNull()
      btn.focus()
      expect(btn).toHaveFocus()
    })

    it('click and Enter schedule nothing and do not navigate', async () => {
      renderPage()
      const btn = screen.getByRole('button', { name: 'Delete task' })
      await userEvent.click(btn)
      btn.focus()
      await userEvent.keyboard('{Enter}')
      expect(deleteTask).not.toHaveBeenCalled()
      expect(screen.queryByTestId('tasks-route')).not.toBeInTheDocument()
    })
  })

  it('has no hint and an enabled Delete without subtasks', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Delete task' })).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByText(/delete subtasks first/i)).not.toBeInTheDocument()
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
    expect(await screen.findByText(/tasks completed on a past day cannot be reopened/i)).toBeInTheDocument()
  })

  it('TASK_PARENT_SELF_NOT_ALLOWED error shows proper message', async () => {
    await saveWithUpdateError({ code: 'TASK_PARENT_SELF_NOT_ALLOWED' })
    expect(await screen.findByText(/own parent/i)).toBeInTheDocument()
  })

  describe('TASK_PARENT_COMPLETED_NOT_ALLOWED (#368)', () => {
    const MESSAGE = "A completed task can't have open subtasks. Reopen the parent first, or keep this subtask completed."

    async function failSaveAfterPickingParent() {
      vi.mocked(useTasksQuery).mockReturnValue({
        data: { data: [task, { ...task, id: 7, title: 'Open target', status: 'Todo' }, { ...task, id: 8, title: 'Done target', status: 'Completed' }] },
        isLoading: false,
      } as never)
      updateAsync.mockRejectedValue({ code: 'TASK_PARENT_COMPLETED_NOT_ALLOWED' })
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: /edit/i }))
      await userEvent.selectOptions(screen.getByLabelText('Parent Task'), 'Open target')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
    }

    it('shows the mapped message once in an alert, keeps the form open with the chosen parent', async () => {
      await failSaveAfterPickingParent()
      const alerts = await screen.findAllByRole('alert')
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveTextContent(MESSAGE)
      expect(screen.getAllByText(MESSAGE)).toHaveLength(1)
      expect(screen.getByLabelText('Parent Task')).toHaveValue('7')
    })

    it('clears the error when the parent or status changes', async () => {
      await failSaveAfterPickingParent()
      await screen.findByRole('alert')
      await userEvent.selectOptions(screen.getByLabelText('Parent Task'), 'None')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      await userEvent.selectOptions(screen.getByLabelText('Parent Task'), 'Open target')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await screen.findByRole('alert')
      await userEvent.selectOptions(screen.getByLabelText('Status'), 'draft')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
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

  describe('edit focus (#334)', () => {
    const titleBox = () => screen.getByRole('textbox', { name: /title/i })
    const editBtn = () => screen.getByRole('button', { name: /edit/i })

    it('does not focus the Edit button on initial load', () => {
      renderPage()
      expect(editBtn()).not.toHaveFocus()
    })

    it('Edit click focuses the title input', async () => {
      renderPage()
      await userEvent.click(editBtn())
      expect(titleBox()).toHaveFocus()
    })

    it('Cancel closes the form and focuses the Edit button', async () => {
      renderPage()
      await userEvent.click(editBtn())
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument()
      expect(editBtn()).toHaveFocus()
    })

    it('a successful Save closes the form and focuses the Edit button', async () => {
      renderPage()
      await userEvent.click(editBtn())
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      // Closing is a URL change now, so focus lands in the effect after the form unmounts.
      await waitFor(() => expect(editBtn()).toHaveFocus())
      expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument()
    })

    it('re-opening after a Save focuses the title again', async () => {
      renderPage()
      await userEvent.click(editBtn())
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() => expect(editBtn()).toHaveFocus())
      await userEvent.click(editBtn())
      expect(titleBox()).toHaveFocus()
    })

    it('a failed Save keeps the form open and leaves focus where it was', async () => {
      await saveWithUpdateError({ code: 'UNKNOWN_ERROR' })
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(titleBox()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save/i })).toHaveFocus()
      expect(titleBox()).not.toHaveFocus()
    })

    it('a partial failure (update OK, project change fails) keeps the form open without focusing Edit', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      changeAsync.mockRejectedValueOnce({ message: 'boom' })
      renderPage()
      await userEvent.click(editBtn())
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Beta')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await screen.findByRole('alert')
      expect(titleBox()).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save/i })).toHaveFocus()
    })

    it('does not re-focus the title on rerender while editing', async () => {
      // A fresh element per call: re-rendering the identical element would be a React no-op.
      const tree = () => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/tasks/1']}>
            <Routes>
              <Route path="/tasks/:id" element={<TaskDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      )
      const view = render(tree())
      await userEvent.click(editBtn())
      await userEvent.click(screen.getByLabelText(/description/i))
      expect(screen.getByLabelText(/description/i)).toHaveFocus()
      mockTask({ title: 'Refetched title' })
      view.rerender(tree())
      expect(screen.getByLabelText(/description/i)).toHaveFocus()
      expect(titleBox()).not.toHaveFocus()
    })

    it('renders "Task not found" without throwing when the task disappears while editing', async () => {
      const tree = () => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/tasks/1']}>
            <Routes>
              <Route path="/tasks/:id" element={<TaskDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      )
      const view = render(tree())
      await userEvent.click(editBtn())
      vi.mocked(useTaskQuery).mockReturnValue({ data: undefined, isLoading: false, error: new Error('gone') } as never)
      expect(() => view.rerender(tree())).not.toThrow()
      expect(screen.getByText(/task not found/i)).toBeInTheDocument()
      // The focused title input was unmounted; focus must fall back to body, not a stale node.
      expect(document.body).toHaveFocus()
    })

    it('Cancel clears the save error so re-opening shows none', async () => {
      await saveWithUpdateError({ code: 'UNKNOWN_ERROR' })
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
      await userEvent.click(editBtn())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('edit mode from the URL (#421)', () => {
    function LocationDisplay() {
      const l = useLocation()
      return (
        <div>
          <div data-testid="location">{l.pathname + l.search}</div>
          <div data-testid="loc-state">{JSON.stringify(l.state)}</div>
        </div>
      )
    }
    function BackButton() {
      const navigate = useNavigate()
      return <button onClick={() => navigate(-1)}>history back</button>
    }
    interface ShortcutSpies {
      home: () => void
      tasks: () => void
      help: () => void
      journal: () => void
    }
    function Shortcuts({ spies }: { spies: ShortcutSpies }) {
      useGlobalKeyboardShortcuts({ onGoHome: spies.home, onGoTasks: spies.tasks, onShowHelp: spies.help })
      useJournalKeyboardShortcuts({
        onNewTodo: spies.journal,
        onNewLog: spies.journal,
        onNewNote: spies.journal,
        onPrevDay: spies.journal,
        onNextDay: spies.journal,
        onJumpToToday: spies.journal,
      })
      return null
    }
    type Entry = string | { pathname: string; search?: string; state?: unknown }
    const tree = (entries: Entry[], spies?: ShortcutSpies) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
          <LocationDisplay />
          <BackButton />
          {spies && <Shortcuts spies={spies} />}
          <Routes>
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/tasks" element={<div>Tasks list</div>} />
            <Route path="/journal/:date" element={<div>Journal day</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    const renderAt = (...entries: Entry[]) => render(tree(entries))
    const titleBox = () => screen.getByRole('textbox', { name: /title/i })
    const editBtn = () => screen.getByRole('button', { name: 'Edit' })
    const where = () => screen.getByTestId('location')

    it('?edit=1 opens the form with the title focused', () => {
      renderAt('/tasks/1?edit=1')
      expect(titleBox()).toHaveValue('Fix login bug')
      expect(titleBox()).toHaveFocus()
    })

    it('a cold-cache deep link focuses the title once the task loads, not while loading', () => {
      vi.mocked(useTaskQuery).mockReturnValue({ data: undefined, isLoading: true, error: null } as never)
      const view = render(tree(['/tasks/1?edit=1']))
      expect(screen.getByText('Loading…')).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument()
      mockTask()
      view.rerender(tree(['/tasks/1?edit=1']))
      expect(titleBox()).toHaveFocus()
    })

    it('a background refetch does not steal focus or touch typed input', async () => {
      const view = render(tree(['/tasks/1?edit=1']))
      await userEvent.type(titleBox(), ' typed')
      await userEvent.click(screen.getByLabelText(/description/i))
      mockTask({ title: 'Refetched title' })
      view.rerender(tree(['/tasks/1?edit=1']))
      expect(screen.getByLabelText(/description/i)).toHaveFocus()
      expect(titleBox()).toHaveValue('Fix login bug typed')
    })

    it.each([
      ['edit=0', '?edit=0'],
      ['edit=true', '?edit=true'],
      ['an empty edit', '?edit='],
      ['two edit values', '?edit=1&edit=2'],
      ['a capitalised key', '?Edit=1'],
    ])('stays in read mode for %s', (_label, search) => {
      renderAt(`/tasks/1${search}`)
      expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument()
      expect(editBtn()).toBeInTheDocument()
    })

    it('shows Task not found and no form for a missing task with ?edit=1', () => {
      vi.mocked(useTaskQuery).mockReturnValue({ data: undefined, isLoading: false, error: null } as never)
      renderAt('/tasks/1?edit=1')
      expect(screen.getByText('Task not found.')).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument()
    })

    it('shows the error view for a non-numeric id with ?edit=1', () => {
      renderAt('/tasks/abc?edit=1')
      expect(screen.getByText('Task not found.')).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument()
    })

    it('Save from a deep link returns to read mode, drops ?edit, focuses Edit and adds no history entry', async () => {
      renderAt('/tasks', '/tasks/1?edit=1')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() => expect(where()).toHaveTextContent(/^\/tasks\/1$/))
      expect(editBtn()).toHaveFocus()
      // Replace, not push: one history step back leaves the page instead of reopening the form.
      await userEvent.click(screen.getByRole('button', { name: 'history back' }))
      expect(where()).toHaveTextContent(/^\/tasks$/)
    })

    it('Cancel from a deep link returns to read mode, drops ?edit, focuses Edit and adds no history entry', async () => {
      renderAt('/tasks', '/tasks/1?edit=1')
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(where()).toHaveTextContent(/^\/tasks\/1$/)
      expect(editBtn()).toHaveFocus()
      await userEvent.click(screen.getByRole('button', { name: 'history back' }))
      expect(where()).toHaveTextContent(/^\/tasks$/)
    })

    it('the in-page Edit button sets ?edit=1 by replace and focuses the title', async () => {
      renderAt('/tasks', '/tasks/1')
      await userEvent.click(editBtn())
      expect(where()).toHaveTextContent('/tasks/1?edit=1')
      expect(titleBox()).toHaveFocus()
      await userEvent.click(screen.getByRole('button', { name: 'history back' }))
      expect(where()).toHaveTextContent(/^\/tasks$/)
    })

    it('waits for the refetch of a cached task before opening the form, then keeps it open', () => {
      const result = (isFetching: boolean, title: string) => ({
        data: { data: { ...task, title } },
        isLoading: false,
        isFetching,
        error: null,
      }) as never
      vi.mocked(useTaskQuery).mockReturnValue(result(true, 'Stale title'))
      const view = render(tree(['/tasks/1?edit=1']))
      expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument()
      vi.mocked(useTaskQuery).mockReturnValue(result(false, 'Fresh title'))
      view.rerender(tree(['/tasks/1?edit=1']))
      expect(titleBox()).toHaveValue('Fresh title')
      // A later background refetch must not unmount the form.
      vi.mocked(useTaskQuery).mockReturnValue(result(true, 'Fresh title'))
      view.rerender(tree(['/tasks/1?edit=1']))
      expect(titleBox()).toHaveValue('Fresh title')
    })

    it('does not navigate back to the task when the user leaves while a save is in flight', async () => {
      let resolveSave!: (v: unknown) => void
      updateAsync.mockReturnValue(new Promise(r => { resolveSave = r }))
      renderAt('/tasks', '/tasks/1?edit=1')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByRole('button', { name: 'history back' }))
      expect(where()).toHaveTextContent(/^\/tasks$/)
      await act(async () => { resolveSave({}) })
      expect(where()).toHaveTextContent(/^\/tasks$/)
    })

    it('keeps other search params when opening and closing', async () => {
      renderAt('/tasks/1?x=1')
      await userEvent.click(editBtn())
      expect(where()).toHaveTextContent(/^\/tasks\/1\?x=1&edit=1$/)
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(where()).toHaveTextContent(/^\/tasks\/1\?x=1$/)
    })

    it('keeps the journal origin state through save so Back to Journal still hands back the focus id', async () => {
      renderAt({ pathname: '/tasks/1', search: '?edit=1', state: { from: '/journal/11-07-2026', focusTaskId: 7 } })
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() => expect(where()).toHaveTextContent(/^\/tasks\/1$/))
      expect(JSON.parse(screen.getByTestId('loc-state').textContent ?? 'null')).toEqual({
        from: '/journal/11-07-2026',
        focusTaskId: 7,
      })
      const back = screen.getByRole('link', { name: '← Back to Journal' })
      expect(back).toHaveAttribute('href', '/journal/11-07-2026')
      await userEvent.click(back)
      expect(where()).toHaveTextContent('/journal/11-07-2026')
      expect(JSON.parse(screen.getByTestId('loc-state').textContent ?? 'null')).toEqual({ focusTaskId: 7 })
    })

    it('keeps the journal origin state through cancel', async () => {
      renderAt({ pathname: '/tasks/1', search: '?edit=1', state: { from: '/journal/11-07-2026', focusTaskId: 7 } })
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(JSON.parse(screen.getByTestId('loc-state').textContent ?? 'null')).toEqual({
        from: '/journal/11-07-2026',
        focusTaskId: 7,
      })
    })

    it('the journal back link is the same with and without ?edit=1 (origin comes from state only)', () => {
      const state = { from: '/journal/11-07-2026', focusTaskId: 1 }
      const { unmount } = renderAt({ pathname: '/tasks/1', state })
      const plain = screen.getByRole('link', { name: /^← Back to/ }).getAttribute('href')
      unmount()
      renderAt({ pathname: '/tasks/1', search: '?edit=1', state })
      expect(screen.getByRole('link', { name: /^← Back to/ })).toHaveAttribute('href', plain)
    })

    it('shows Back to Tasks for a ?edit=1 deep link without state', () => {
      renderAt('/tasks/1?edit=1')
      expect(screen.getByRole('link', { name: '← Back to Tasks' })).toHaveAttribute('href', '/tasks')
    })

    it('a journal-origin edit save sends only the form fields: no planned day or journal date', async () => {
      renderAt({ pathname: '/tasks/1', search: '?edit=1', state: { from: '/journal/11-07-2026', focusTaskId: 1 } })
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1))
      const sent = updateAsync.mock.calls[0][0].data
      expect(Object.keys(sent).filter(k => /journal|planned/i.test(k))).toEqual([])
    })

    it('opens a derived task in edit mode with the status select disabled', () => {
      const child = { ...task, id: 9, title: 'Child', status: 'InProgress', parentTaskItemId: 1 }
      mockTask({ childTaskCount: 1 })
      vi.mocked(useTasksQuery).mockReturnValue({ data: { data: [{ ...task, childTaskCount: 1 }, child] }, isLoading: false } as never)
      renderAt('/tasks/1?edit=1')
      expect(screen.getByRole('combobox', { name: 'Status' })).toBeDisabled()
      expect(titleBox()).not.toBeDisabled()
    })

    it('Enter in the title field submits the form', async () => {
      renderAt('/tasks/1?edit=1')
      await userEvent.type(titleBox(), ' v2{Enter}')
      await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1))
      expect(updateAsync.mock.calls[0][0].data.title).toBe('Fix login bug v2')
    })

    it('a failed save keeps the form and ?edit=1, announces the error in an alert and preserves input', async () => {
      updateAsync.mockRejectedValue({ code: 'UNKNOWN_ERROR' })
      renderAt('/tasks/1?edit=1')
      await userEvent.type(titleBox(), ' keep')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/unable to save task changes/i)
      expect(where()).toHaveTextContent('/tasks/1?edit=1')
      expect(titleBox()).toHaveValue('Fix login bug keep')
      expect(screen.getByRole('button', { name: /save/i })).toHaveFocus()
    })

    it('a partial failure after a project change keeps the form and ?edit=1', async () => {
      mockTask({ projectId: 1, projectName: 'Alpha' })
      changeAsync.mockRejectedValueOnce({ message: 'boom' })
      renderAt('/tasks/1?edit=1')
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Beta')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(where()).toHaveTextContent('/tasks/1?edit=1')
      expect(titleBox()).toBeInTheDocument()
    })

    it('deleting does not move focus to the Edit button', async () => {
      renderAt('/tasks/1')
      await userEvent.click(screen.getByRole('button', { name: /delete task/i }))
      expect(where()).toHaveTextContent(/^\/tasks$/)
      expect(document.activeElement?.textContent).not.toBe('Edit')
    })

    it('shortcuts and chords do not fire while the auto-focused title is typed into', async () => {
      const spies = { home: vi.fn(), tasks: vi.fn(), help: vi.fn(), journal: vi.fn() }
      render(tree(['/tasks/1?edit=1'], spies))
      expect(titleBox()).toHaveFocus()
      await userEvent.clear(titleBox())
      // '[[' is user-event's escape for a literal '['.
      await userEvent.keyboard('thgnjl[[]?')
      expect(titleBox()).toHaveValue('thgnjl[]?')
      expect(where()).toHaveTextContent('/tasks/1?edit=1')
      for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled()
    })
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

describe('TaskDetailPage on mobile (#320)', () => {
  const note = { id: 7, content: 'A note', taskItemId: 1 }

  function setTouch(coarse: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn((query: string) => ({ matches: coarse && query.includes('pointer: coarse') })),
      configurable: true,
      writable: true,
    })
    __resetCoarsePointerCache()
  }

  const projectName = (container: HTMLElement) => container.querySelector('.t-detail-project-name')

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    updateAsync.mockReset().mockResolvedValue({})
    changeAsync.mockReset().mockResolvedValue(undefined)
    changeMutate.mockReset()
    vi.mocked(usePrefs).mockReturnValue(makePrefs())
    vi.mocked(useProjectsQuery).mockReturnValue({ data: { data: projects }, isSuccess: true } as never)
    mockChange()
    mockTask({ projectId: 1, projectName: 'Alpha' })
    vi.mocked(useTasksQuery).mockReturnValue({ data: { data: [task] }, isLoading: false } as never)
    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(useTaskHistoryQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutate: vi.fn(), mutateAsync: updateAsync, isPending: false } as never)
    vi.mocked(useDeleteTaskUndoable).mockReturnValue(deleteTask)
    vi.mocked(useCreateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useUpdateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useDeleteNoteUndoable).mockReturnValue(deleteNote)
    setTouch(true)
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
  })

  it('scopes the page under the tasks-page root', () => {
    const { container } = renderPage()
    expect(container.firstElementChild).toHaveClass('tasks-page')
  })

  it('shows blocked reason and project name as visible text, not only in title attributes', () => {
    mockTask({ projectId: 1, projectName: 'Alpha', status: 'Blocked', blockedReason: 'Waiting on legal sign-off' })
    const { container } = renderPage()
    expect(screen.getByText('Waiting on legal sign-off')).toBeVisible()
    expect(projectName(container)).toHaveTextContent('Alpha')
    expect(projectName(container)).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /project/i })).toHaveDisplayValue('Alpha')
  })

  it('shows a very long unbroken blocked reason as visible text in the meta', () => {
    const reason = 'https://example.com/' + 'a'.repeat(200)
    mockTask({ projectId: 1, projectName: 'Alpha', status: 'Blocked', blockedReason: reason })
    renderPage()
    expect(screen.getByText(reason)).toBeVisible()
  })

  it('renders no project-name span for "No project"', () => {
    mockTask({ projectId: null, projectName: null })
    const { container } = renderPage()
    expect(projectName(container)).toBeNull()
  })

  it('still saves a quick project change on touch', async () => {
    renderPage()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'Beta')
    expect(changeMutate).toHaveBeenCalledWith({ taskId: 1, fromProjectId: 1, toProjectId: 2 }, expect.any(Object))
  })

  it('tracks the select value in the visible project name after a quick change', async () => {
    const { container } = renderPage()
    expect(projectName(container)).toHaveTextContent('Alpha')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'Beta')
    expect(projectName(container)).toHaveTextContent('Beta')
  })

  it('keeps the visible project name on the new project after the quick change succeeds', async () => {
    const { container } = renderPage()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'Beta')
    const options = changeMutate.mock.calls[0][1] as { onSuccess?: () => void }
    act(() => options.onSuccess?.())
    expect(screen.getByRole('combobox', { name: /project/i })).toHaveDisplayValue('Beta')
    expect(projectName(container)).toHaveTextContent('Beta')
  })

  it('reverts the visible project name with the select to the server value when the quick change fails', async () => {
    const { container } = renderPage()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'Beta')
    const options = changeMutate.mock.calls[0][1] as { onError: (err: unknown) => void }
    act(() => options.onError(new Error('boom')))
    expect(screen.getByRole('combobox', { name: /project/i })).toHaveDisplayValue('Alpha')
    expect(projectName(container)).toHaveTextContent('Alpha')
  })

  it('replaces the panel inline with the TaskForm when Edit is clicked on touch', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('heading', { name: 'Edit Task' })).toBeInTheDocument()
    expect(screen.getByLabelText(/title/i)).toHaveValue('Fix login bug')
    expect(screen.queryByRole('heading', { name: 'Fix login bug' })).not.toBeInTheDocument()
  })

  it('keeps Edit before Delete task in DOM order', () => {
    renderPage()
    const edit = screen.getByRole('button', { name: 'Edit' })
    const del = screen.getByRole('button', { name: 'Delete task' })
    expect(edit.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('deletes a note without confirm and focuses the next note, then Add Note (AC17, AC18)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const note2 = { ...note, id: 8, content: 'Second note' }
    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [note, note2] }, isLoading: false } as never)
    renderPage()
    const deletes = screen.getAllByRole('button', { name: /delete note/i })
    expect(deletes).toHaveLength(2)
    await userEvent.click(deletes[0])
    expect(deleteNote).toHaveBeenCalledWith(7, expect.any(Function))
    // Focus moved synchronously, before the note left the list.
    expect(deletes[1]).toHaveFocus()
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('focuses the previous note, and Add Note when it was the only one', async () => {
    const note2 = { ...note, id: 8, content: 'Second note' }
    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [note, note2] }, isLoading: false } as never)
    const { unmount } = renderPage()
    const deletes = screen.getAllByRole('button', { name: /delete note/i })
    await userEvent.click(deletes[1])
    expect(deletes[0]).toHaveFocus()
    unmount()

    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [note] }, isLoading: false } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /delete note/i }))
    expect(screen.getByRole('button', { name: 'Add Note' })).toHaveFocus()
  })

  it('restoring a note focuses its Delete button', async () => {
    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [note] }, isLoading: false } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /delete note/i }))
    const restoreFocus = deleteNote.mock.calls[0][1] as () => void
    restoreFocus()
    expect(screen.getByRole('button', { name: /delete note/i })).toHaveFocus()
  })

  it('labels: the task Delete and the note Delete both show "Delete" (AC23, AC24)', () => {
    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [note] }, isLoading: false } as never)
    renderPage()
    expect(screen.getByRole('button', { name: /delete task/i })).toHaveTextContent('Delete')
    expect(screen.getByRole('button', { name: /delete note/i })).toHaveTextContent('Delete')
  })

  it('renders the same structure with a fine pointer (desktop)', () => {
    setTouch(false)
    const { container } = renderPage()
    expect(container.firstElementChild).toHaveClass('tasks-page')
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /project/i })).toHaveDisplayValue('Alpha')
    expect(projectName(container)).toHaveTextContent('Alpha')
  })
})

describe('TaskDetailPage derived status (#385)', () => {
  const child = (status: string) => ({ ...task, id: 9, title: 'Child', status, parentTaskItemId: 1 })

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    updateAsync.mockReset().mockResolvedValue({})
    changeAsync.mockReset().mockResolvedValue(undefined)
    changeMutate.mockReset()
    vi.mocked(usePrefs).mockReturnValue(makePrefs())
    vi.mocked(useProjectsQuery).mockReturnValue({ data: { data: projects }, isSuccess: true } as never)
    mockChange()
    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(useTaskHistoryQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutate: vi.fn(), mutateAsync: updateAsync, isPending: false } as never)
    vi.mocked(useDeleteTaskUndoable).mockReturnValue(deleteTask)
    vi.mocked(useCreateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useUpdateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useDeleteNoteUndoable).mockReturnValue(deleteNote)
  })

  function withChildren(stored: Record<string, unknown>, children: unknown[]) {
    const parent = { ...task, ...stored }
    vi.mocked(useTaskQuery).mockReturnValue({ data: { data: parent }, isLoading: false, error: null } as never)
    vi.mocked(useTasksQuery).mockReturnValue({ data: { data: [parent, ...children] }, isLoading: false } as never)
  }

  it('shows the derived status, a dashed badge and a note, and hides the stored reason', () => {
    withChildren({ status: 'Blocked', blockedReason: 'Waiting on Sam' }, [child('InProgress')])
    renderPage()
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0)
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument()
    expect(screen.queryByText('Waiting on Sam')).not.toBeInTheDocument()
    expect(screen.getByText('Follows open subtasks')).toBeInTheDocument()
    const badge = document.querySelector('.t-badge-derived')
    expect(badge).toHaveAttribute('title', expect.stringContaining('1 open subtask.'))
  })

  it('shows the stored status and reason when all subtasks are Completed', () => {
    withChildren({ status: 'Blocked', blockedReason: 'Waiting on Sam' }, [child('Completed')])
    renderPage()
    expect(screen.getByText('Waiting on Sam')).toBeInTheDocument()
    expect(document.querySelector('.t-badge-derived')).toBeNull()
  })

  it('edit form has a disabled status select and submits the stored status without a reason', async () => {
    withChildren({ status: 'Blocked', blockedReason: 'Waiting on Sam' }, [child('InProgress')])
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const select = screen.getByRole('combobox', { name: 'Status' })
    expect(select).toBeDisabled()
    expect(select).toHaveValue('inprogress')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateAsync).toHaveBeenCalled())
    const sent = updateAsync.mock.calls[0][0].data
    expect(sent.status).toBe('blocked')
    expect(sent).not.toHaveProperty('blockedReason')
  })

  it('parent picker uses the stored status: Completed with an open child is disabled, open-stored with all-Completed children is not', async () => {
    const doneWithOpenKid = { ...task, id: 20, title: 'Shipped', status: 'Completed' }
    const openWithDoneKid = { ...task, id: 21, title: 'Wrapping up', status: 'Todo' }
    withChildren({ status: 'Todo' }, [
      doneWithOpenKid,
      openWithDoneKid,
      { ...task, id: 22, title: 'Open kid', status: 'Todo', parentTaskItemId: 20 },
      { ...task, id: 23, title: 'Done kid', status: 'Completed', parentTaskItemId: 21 },
    ])
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('option', { name: 'Shipped (completed)' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Wrapping up' })).toBeEnabled()
  })
})
