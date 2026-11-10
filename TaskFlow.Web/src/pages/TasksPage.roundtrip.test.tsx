import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { TasksPage } from './TasksPage'
import { TaskDetailPage } from './TaskDetailPage'

vi.mock('@/hooks/useTasks', () => ({
  useTaskQuery: vi.fn(),
  useTasksQuery: vi.fn(),
  useTaskHistoryQuery: vi.fn(),
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
vi.mock('@/hooks/useProjects', () => ({ useProjectsQuery: vi.fn(), useChangeTaskProject: vi.fn() }))
vi.mock('@/hooks/useNotes', () => ({
  useNotesQuery: vi.fn(),
  useCreateNoteMutation: vi.fn(),
  useUpdateNoteMutation: vi.fn(),
}))
vi.mock('@/hooks/useDeleteTaskUndoable', () => ({
  useDeleteTaskUndoable: vi.fn(),
  useDeleteNoteUndoable: vi.fn(),
}))
vi.mock('@/context/usePrefs', () => ({ usePrefs: vi.fn() }))
vi.mock('@/components/TaskHistoryPanel', () => ({ TaskHistoryPanel: () => <div /> }))
vi.mock('@/api/journal', () => ({ removeJournalTodo: vi.fn() }))

import {
  useTaskQuery,
  useTasksQuery,
  useTaskHistoryQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useBlockTaskMutation,
  useUnblockTaskMutation,
  useEditBlockedReasonMutation,
} from '@/hooks/useTasks'
import { useProjectsQuery, useChangeTaskProject } from '@/hooks/useProjects'
import { useNotesQuery, useCreateNoteMutation, useUpdateNoteMutation } from '@/hooks/useNotes'
import { useDeleteTaskUndoable, useDeleteNoteUndoable } from '@/hooks/useDeleteTaskUndoable'
import { usePrefs } from '@/context/usePrefs'
import type { PrefsContextValue } from '@/context/PrefsContextDef'

const baseTask = {
  description: null,
  priority: 'High',
  dueDate: null,
  parentTaskItemId: null,
  childTaskCount: 0,
  currentJournalDate: null,
  moveCount: 0,
  daysTagged: 1,
  projectId: null,
  projectName: null,
}
const task = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  ...baseTask,
  id,
  title,
  status: 'Todo',
  ...extra,
})

let queryClient: QueryClient
let tasks: ReturnType<typeof task>[]

function LocationDisplay() {
  const l = useLocation()
  return <div data-testid="location">{l.pathname + l.search}</div>
}
function HistoryBack() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>history back</button>
}

function renderApp(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationDisplay />
        <HistoryBack />
        <Routes>
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const searchBox = () => screen.getByPlaceholderText('Search title or #id…')
const where = () => screen.getByTestId('location').textContent
const titles = () => Array.from(document.querySelectorAll('.t-task-link')).map(a => a.textContent)
const backLink = () => screen.getByRole('link', { name: /back to tasks/i })

describe('Tasks list to detail and back, end to end (#469 AC1, AC2, AC3, AC5, AC6, edge cases)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    tasks = [
      task(1, 'Foo one'),
      task(2, 'Foo two', { status: 'Draft' }),
      task(3, 'Bar three'),
      task(10, 'Parent task'),
      task(11, 'Kid thing', { parentTaskItemId: 10 }),
    ]
    const prefs: PrefsContextValue = {
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
    vi.mocked(usePrefs).mockReturnValue(prefs)
    vi.mocked(useTasksQuery).mockImplementation((() => ({ data: { data: tasks }, isLoading: false, error: null })) as never)
    vi.mocked(useTaskQuery).mockImplementation(((id: number) => ({
      data: { data: tasks.find(t => t.id === id) },
      isLoading: false,
      isFetching: false,
      error: null,
    })) as never)
    vi.mocked(useTaskHistoryQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(useProjectsQuery).mockReturnValue({
      data: { data: [{ id: 1, name: 'Alpha', isArchived: false }] },
      isSuccess: true,
    } as never)
    const mutation = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }
    vi.mocked(useCreateTaskMutation).mockReturnValue(mutation as never)
    vi.mocked(useUpdateTaskMutation).mockReturnValue(mutation as never)
    vi.mocked(useBlockTaskMutation).mockReturnValue(mutation as never)
    vi.mocked(useUnblockTaskMutation).mockReturnValue(mutation as never)
    vi.mocked(useEditBlockedReasonMutation).mockReturnValue(mutation as never)
    vi.mocked(useChangeTaskProject).mockReturnValue(mutation as never)
    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(useCreateNoteMutation).mockReturnValue(mutation as never)
    vi.mocked(useUpdateNoteMutation).mockReturnValue(mutation as never)
    vi.mocked(useDeleteTaskUndoable).mockReturnValue(vi.fn())
    vi.mocked(useDeleteNoteUndoable).mockReturnValue(vi.fn())
  })

  it('title link then the back link returns to the same filters and rows (AC1)', async () => {
    renderApp('/tasks?q=foo&status=todo')
    expect(titles()).toEqual(['Foo one'])
    await userEvent.click(screen.getByRole('link', { name: 'Foo one' }))
    expect(where()).toBe('/tasks/1')
    await userEvent.click(backLink())
    expect(where()).toBe('/tasks?q=foo&status=todo')
    expect(searchBox()).toHaveValue('foo')
    expect(screen.getByRole('checkbox', { name: 'Draft' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'To-do' })).toBeChecked()
    expect(titles()).toEqual(['Foo one'])
  })

  it('Edit, Cancel on the detail page, then the back link returns to the filtered list (AC1, AC5)', async () => {
    renderApp('/tasks?q=foo&status=todo')
    await userEvent.click(screen.getByRole('button', { name: 'Edit Foo one' }))
    expect(where()).toBe('/tasks/1?edit=1')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(where()).toBe('/tasks/1')
    await userEvent.click(backLink())
    expect(where()).toBe('/tasks?q=foo&status=todo')
    expect(titles()).toEqual(['Foo one'])
  })

  it('the parent link then the back link returns to the filtered list (AC3)', async () => {
    renderApp('/tasks?q=kid')
    await userEvent.click(screen.getByRole('link', { name: 'Parent task' }))
    expect(where()).toBe('/tasks/10')
    await userEvent.click(backLink())
    expect(where()).toBe('/tasks?q=kid')
    expect(searchBox()).toHaveValue('kid')
    expect(titles()).toContain('Kid thing')
    expect(titles()).not.toContain('Bar three')
  })

  it('browser Back from the detail page restores the filtered list (AC2)', async () => {
    renderApp('/tasks?status=draft')
    await userEvent.click(screen.getByRole('link', { name: 'Foo two' }))
    await userEvent.click(screen.getByRole('button', { name: 'history back' }))
    expect(where()).toBe('/tasks?status=draft')
    expect(titles()).toEqual(['Foo two'])
  })

  it('an edited task that no longer matches the filters is hidden on return', async () => {
    renderApp('/tasks?status=todo')
    expect(titles()).toContain('Foo one')
    await userEvent.click(screen.getByRole('link', { name: 'Foo one' }))
    // The edit changes the status so it no longer matches the Todo filter.
    tasks = tasks.map(t => (t.id === 1 ? { ...t, status: 'Completed' } : t))
    await userEvent.click(backLink())
    expect(where()).toBe('/tasks?status=todo')
    expect(titles()).not.toContain('Foo one')
    expect(titles()).toContain('Bar three')
  })

  it('delete from the detail page lands on the same filtered URL with the filters intact (AC6)', async () => {
    const remove = vi.fn()
    vi.mocked(useDeleteTaskUndoable).mockReturnValue(remove)
    renderApp('/tasks?q=foo&status=todo')
    await userEvent.click(screen.getByRole('link', { name: 'Foo one' }))
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(where()).toBe('/tasks?q=foo&status=todo'))
    expect(searchBox()).toHaveValue('foo')
    expect(screen.getByRole('checkbox', { name: 'Draft' })).not.toBeChecked()
  })

  it('probe: a search with encoded "/", ":" and "#" still round-trips through the back link (AC11, AC17)', async () => {
    tasks = [...tasks, task(20, 'a//b:c#d one')]
    renderApp('/tasks?q=a%2F%2Fb%3Ac%23d')
    expect(titles()).toEqual(['a//b:c#d one'])
    await userEvent.click(screen.getByRole('link', { name: 'a//b:c#d one' }))
    await userEvent.click(backLink())
    expect(where()).toBe('/tasks?q=a%2F%2Fb%3Ac%23d')
    expect(searchBox()).toHaveValue('a//b:c#d')
    expect(titles()).toEqual(['a//b:c#d one'])
  })

  it('probe: a whitespace-only q is treated as empty and shows every task (AC10)', () => {
    renderApp('/tasks')
    const plain = titles()
    cleanup()
    renderApp('/tasks?q=%20%20')
    expect(titles()).toEqual(plain)
  })
})
