import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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

function DetailProbe() {
  const l = useLocation()
  return (
    <div>
      <div data-testid="detail-state">{JSON.stringify(l.state)}</div>
      <div data-testid="detail-path">{l.pathname + l.search}</div>
    </div>
  )
}

function HistoryBack() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>history back</button>
}

function renderPage(entries: string[] = ['/tasks'], index?: number) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={entries} initialIndex={index}>
        <LocationDisplay />
        <HistoryBack />
        {/* Stands in for the Nav "Tasks" link and the `g t` chord: both go to plain /tasks. */}
        <Link to="/tasks">to plain tasks</Link>
        <Routes>
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:id" element={<DetailProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const useData = (data: unknown[]) =>
  vi.mocked(useTasksQuery).mockReturnValue({ data: { data }, isLoading: false, error: null } as never)
const searchBox = () => screen.getByPlaceholderText('Search title or #id…')
const where = () => screen.getByTestId('location').textContent
const titles = () => Array.from(document.querySelectorAll('.t-task-link')).map(a => a.textContent)
const detailState = () => JSON.parse(screen.getByTestId('detail-state').textContent ?? 'null')
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const task = (id: number, title: string, extra: Record<string, unknown> = {}) =>
  ({ ...baseTask, id, title, status: 'Todo', priority: 'High', ...extra })

describe('TasksPage filters in the URL (#469)', () => {
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
    vi.mocked(useCreateTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useUpdateTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useBlockTaskMutation).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.mocked(useUnblockTaskMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useEditBlockedReasonMutation).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.mocked(useChangeTaskProject).mockReturnValue({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useProjectsQuery).mockReturnValue({
      data: { data: [{ id: 1, name: 'Alpha', isArchived: false }] },
      isSuccess: true,
    } as never)
    useData([task(1, 'Foo one'), task(2, 'Foo two', { status: 'Draft' }), task(3, 'Bar three')])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies filters from the URL on the first paint, with no unfiltered flash (AC14)', () => {
    renderPage(['/tasks?q=zzz'])
    expect(searchBox()).toHaveValue('zzz')
    expect(titles()).toEqual([])
    expect(screen.getByText('No tasks match your filters.')).toBeInTheDocument()
  })

  it('applies status and search from the URL', () => {
    renderPage(['/tasks?status=draft&q=foo'])
    expect(titles()).toEqual(['Foo two'])
    expect(screen.getByRole('checkbox', { name: 'Draft' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'To-do' })).not.toBeChecked()
  })

  it('invalid params fall back to the defaults without crashing', () => {
    renderPage(['/tasks?status=bogus&view=nope&project=abc'])
    expect(titles()).toHaveLength(3)
    screen.getAllByRole('checkbox').forEach(box => expect(box).toBeChecked())
  })

  it('writes status, view and project changes to the URL', async () => {
    renderPage(['/tasks'])
    await userEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
    expect(where()).toBe('/tasks?status=todo&status=inProgress&status=blocked&status=completed')
    await userEvent.click(screen.getByRole('button', { name: 'Active today' }))
    await userEvent.selectOptions(screen.getByLabelText('Project'), '1')
    expect(where()).toContain('view=activeToday')
    expect(where()).toContain('project=1')
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(where()).not.toContain('view=')
  })

  it('one history Back after several filter changes leaves the list (replace, not push)', async () => {
    renderPage(['/tasks/9', '/tasks'], 1)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
    await userEvent.click(screen.getByRole('button', { name: 'Active today' }))
    await userEvent.selectOptions(screen.getByLabelText('Project'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await userEvent.click(screen.getByRole('button', { name: 'history back' }))
    expect(where()).toBe('/tasks/9')
  })

  it('writes the typed search to the URL after the debounce without dropping characters or moving focus', async () => {
    renderPage(['/tasks'])
    const box = searchBox()
    await userEvent.type(box, 'foo bar')
    await waitFor(() => expect(where()).toBe('/tasks?q=foo+bar'))
    expect(searchBox()).toBe(box)
    expect(box).toHaveValue('foo bar')
    expect(box).toHaveFocus()
    // The URL echo must not overwrite text typed after the write.
    await userEvent.type(box, 'x')
    expect(box).toHaveValue('foo barx')
    await waitFor(() => expect(where()).toBe('/tasks?q=foo+barx'))
    expect(box).toHaveValue('foo barx')
  })

  it('Edit carries the filtered list as origin state (AC1)', async () => {
    renderPage(['/tasks?q=foo&status=todo'])
    await userEvent.click(screen.getByRole('button', { name: 'Edit Foo one' }))
    expect(screen.getByTestId('detail-path')).toHaveTextContent('/tasks/1?edit=1')
    expect(detailState()).toEqual({ from: '/tasks?q=foo&status=todo' })
  })

  it('the title link carries the filtered list as origin state (AC2)', async () => {
    renderPage(['/tasks?q=foo&status=todo'])
    await userEvent.click(screen.getByRole('link', { name: 'Foo one' }))
    expect(detailState()).toEqual({ from: '/tasks?q=foo&status=todo' })
  })

  it('a list with no filters carries /tasks as origin', async () => {
    renderPage(['/tasks'])
    await userEvent.click(screen.getByRole('link', { name: 'Bar three' }))
    expect(detailState()).toEqual({ from: '/tasks' })
  })

  it('the parent link in a context header carries the origin state (AC3)', async () => {
    useData([task(10, 'Parent task'), task(11, 'Child task', { parentTaskItemId: 10 })])
    renderPage(['/tasks?q=child'])
    await userEvent.click(screen.getByRole('link', { name: 'Parent task' }))
    expect(screen.getByTestId('detail-path')).toHaveTextContent('/tasks/10')
    expect(detailState()).toEqual({ from: '/tasks?q=child' })
  })

  it('browser Back from detail restores the typed search and rows', async () => {
    renderPage(['/tasks'])
    await userEvent.type(searchBox(), 'foo')
    await waitFor(() => expect(where()).toBe('/tasks?q=foo'))
    await userEvent.click(screen.getByRole('link', { name: 'Foo one' }))
    await userEvent.click(screen.getByRole('button', { name: 'history back' }))
    expect(where()).toBe('/tasks?q=foo')
    expect(searchBox()).toHaveValue('foo')
    expect(titles()).toEqual(['Foo one', 'Foo two'])
  })

  it('going to plain /tasks resets every filter and empties the search input (intended: Nav and g t reset filters)', async () => {
    renderPage(['/tasks?q=foo&status=todo'])
    expect(searchBox()).toHaveValue('foo')
    await userEvent.click(screen.getByRole('link', { name: 'to plain tasks' }))
    expect(where()).toBe('/tasks')
    expect(searchBox()).toHaveValue('')
    screen.getAllByRole('checkbox').forEach(box => expect(box).toBeChecked())
    expect(titles()).toHaveLength(3)
  })

  it('re-syncs the input after text the page wrote itself is reset externally', async () => {
    renderPage(['/tasks'])
    await userEvent.type(searchBox(), 'foo')
    await waitFor(() => expect(where()).toBe('/tasks?q=foo'))
    await userEvent.click(screen.getByRole('link', { name: 'to plain tasks' }))
    expect(searchBox()).toHaveValue('')
  })

  describe('stale project (AC15)', () => {
    it('treats an unknown project as all, then removes it from the URL keeping other params', async () => {
      renderPage(['/tasks?project=999&q=foo'])
      expect(titles()).toEqual(['Foo one', 'Foo two'])
      await waitFor(() => expect(where()).toBe('/tasks?q=foo'))
    })

    it('does not clear the project while the projects query is loading', async () => {
      vi.mocked(useProjectsQuery).mockReturnValue({ data: undefined, isSuccess: false, isLoading: true } as never)
      renderPage(['/tasks?project=999'])
      await pause(50)
      expect(where()).toBe('/tasks?project=999')
    })

    it('does not clear the project when the projects query errored', async () => {
      vi.mocked(useProjectsQuery).mockReturnValue({ data: undefined, isSuccess: false, isError: true } as never)
      renderPage(['/tasks?project=999'])
      await pause(50)
      expect(where()).toBe('/tasks?project=999')
    })

    it('removing the stale project adds no history entry', async () => {
      renderPage(['/tasks/9', '/tasks?project=999'], 1)
      await waitFor(() => expect(where()).toBe('/tasks'))
      await userEvent.click(screen.getByRole('button', { name: 'history back' }))
      expect(where()).toBe('/tasks/9')
    })
  })

  it('writes no localStorage for URL-driven filter changes (AC16)', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    renderPage(['/tasks'])
    await userEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
    await userEvent.type(searchBox(), 'foo')
    await waitFor(() => expect(where()).toContain('q=foo'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('a padded numeric q still matches by task id (#423)', () => {
    renderPage(['/tasks?q=%203%20'])
    expect(titles()).toEqual(['Bar three'])
  })
})
