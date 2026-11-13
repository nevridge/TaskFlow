import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

vi.mock('@/hooks/useJournal', () => ({
  useJournalEntries: vi.fn(),
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
import { useJournalEntries } from '@/hooks/useJournal'
import { usePrefs } from '@/context/usePrefs'
import type { PrefsContextValue } from '@/context/PrefsContextDef'

const taskMutations = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
}
const changeAsync = vi.fn()
const blockAsync = vi.fn()
const unblockMutate = vi.fn()
const editReasonAsync = vi.fn()

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

/** Opens a collapsed section (Blocked and Completed start collapsed). */
async function expandSection(label: string) {
  const toggle = screen.getByRole('button', { name: new RegExp(`^${label} ·`) })
  if (toggle.getAttribute('aria-expanded') === 'false') await userEvent.click(toggle)
}

describe('TasksPage', () => {
  beforeEach(() => {
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
    changeAsync.mockReset().mockResolvedValue(undefined)
    vi.mocked(useCreateTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useUpdateTaskMutation).mockReturnValue(taskMutations as never)
    blockAsync.mockReset().mockResolvedValue({})
    unblockMutate.mockReset()
    editReasonAsync.mockReset().mockResolvedValue({})
    vi.mocked(useBlockTaskMutation).mockReturnValue({ mutateAsync: blockAsync, isPending: false } as never)
    vi.mocked(useUnblockTaskMutation).mockReturnValue({ mutate: unblockMutate, isPending: false } as never)
    vi.mocked(useEditBlockedReasonMutation).mockReturnValue({ mutateAsync: editReasonAsync, isPending: false } as never)
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

  it('shows an alert (not the empty state) when the task list fails to load', () => {
    vi.mocked(useTasksQuery).mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') } as never)
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load tasks.')
    expect(screen.queryByText(/no tasks yet/i)).not.toBeInTheDocument()
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

  it('always shows subtasks under a context header, with no toggle to hide them', () => {
    renderPage()
    expect(screen.getByText('Child task')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /(Hide|Show) subtasks/ })).not.toBeInTheDocument()
  })

  it('shows the id on the subtask row; the parent is only a header link to its detail page', () => {
    renderPage()
    expect(within(rowFor('Child task')).getByRole('img', { name: 'Task 2' })).toHaveTextContent('#2')
    const header = rowFor('Parent task')
    expect(header).toHaveClass('t-context-header')
    expect(within(header).getByRole('link', { name: 'Parent task' })).toHaveAttribute('href', '/tasks/1')
    expect(within(header).queryByRole('img')).not.toBeInTheDocument()
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

    it('puts the project select after the status group', () => {
      renderPage()
      const status = screen.getByRole('group', { name: 'Status' })
      expect(status.compareDocumentPosition(filterSelect()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('tab order in the filter row is Status then Project', async () => {
      renderPage()
      screen.getByRole('checkbox', { name: 'Completed' }).focus()
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
      // Beta finished is Completed: counted, but its section is collapsed by default
      expect(screen.getByText('2 tasks')).toBeInTheDocument()
      expect(screen.queryByText('Beta finished')).not.toBeInTheDocument()
      await expandSection('Completed')
      expect(screen.getByText('Beta finished')).toBeInTheDocument()
    })

    it('shows only the selected project tasks, matching a string projectId by number', async () => {
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'Beta')
      await expandSection('Completed')
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
      await expandSection('Completed')
      expect(screen.getByText('Beta finished')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('checkbox', { name: 'Completed' }))
      expect(screen.queryByText('Beta finished')).not.toBeInTheDocument()
      expect(screen.getByText('No tasks match your filters.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('checkbox', { name: 'Completed' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'To-do' }))
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
      await userEvent.type(screen.getByPlaceholderText(/Search title or #id/), 'Child')
      await waitFor(() => expect(screen.queryByText('Legacy chore')).not.toBeInTheDocument())
      expect(screen.getByText('Child task')).toBeInTheDocument()
      // The parent stays as context for the matching subtask, never as a work row
      expect(rowFor('Parent task')).toHaveClass('t-context-header')
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

  describe('status filter', () => {
    const mixed = [
      { ...baseTask, id: 21, title: 'Draft one', status: 'Draft' },
      { ...baseTask, id: 22, title: 'Todo one', status: 'Todo' },
      { ...baseTask, id: 23, title: 'Completed one', status: 'Completed' },
    ]

    function useData(data: unknown[]) {
      vi.mocked(useTasksQuery).mockReturnValue({ data: { data }, isLoading: false, error: null } as never)
    }
    const box = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name })
    const click = (name: string) => userEvent.click(box(name))

    beforeEach(() => useData(mixed))

    it('defaults to every status checked, Completed included, in a Status group', () => {
      renderPage()
      const group = screen.getByRole('group', { name: 'Status' })
      expect(within(group).getAllByRole('checkbox').map(c => (c as HTMLInputElement).labels?.[0].textContent))
        .toEqual(['Draft', 'To-do', 'In Progress', 'Blocked (0)', 'Completed'])
      expect(box('Draft')).toBeChecked()
      expect(box('To-do')).toBeChecked()
      expect(box('In Progress')).toBeChecked()
      expect(box('Blocked (0)')).toBeChecked()
      expect(box('Completed')).toBeChecked()
      expect(screen.queryByRole('checkbox', { name: 'All' })).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument()
    })

    it('lists every status by default; Completed is counted but its section starts collapsed', () => {
      renderPage()
      expect(screen.getByText('Draft one')).toBeInTheDocument()
      expect(screen.getByText('Todo one')).toBeInTheDocument()
      expect(screen.queryByText('Completed one')).not.toBeInTheDocument()
      expect(screen.getByText('3 tasks')).toBeInTheDocument()
    })

    it('unchecking Completed removes its section; checking it brings it back', async () => {
      renderPage()
      await click('Completed')
      expect(screen.queryByRole('button', { name: /^Completed ·/ })).not.toBeInTheDocument()
      expect(screen.getByText('2 tasks')).toBeInTheDocument()
      await click('Completed')
      await expandSection('Completed')
      expect(screen.getByText('Completed one')).toBeInTheDocument()
      expect(screen.getByText('3 tasks')).toBeInTheDocument()
    })

    it('Completed only', async () => {
      renderPage()
      await click('Draft')
      await click('To-do')
      await expandSection('Completed')
      expect(screen.getByText('Completed one')).toBeInTheDocument()
      expect(screen.queryByText('Draft one')).not.toBeInTheDocument()
      expect(screen.queryByText('Todo one')).not.toBeInTheDocument()
      expect(screen.getByText('1 task')).toBeInTheDocument()
    })

    it('all three selected shows everything', async () => {
      renderPage()
      await expandSection('Completed')
      for (const t of ['Draft one', 'Todo one', 'Completed one']) expect(screen.getByText(t)).toBeInTheDocument()
    })

    it.each([
      ['Draft', 'Draft one'],
      ['To-do', 'Todo one'],
      ['Completed', 'Completed one'],
    ])('only %s selected shows just that status', async (label, title) => {
      renderPage()
      for (const l of ['Draft', 'To-do', 'Completed']) {
        if ((l === label) !== box(l).checked) await click(l)
      }
      for (const l of ['Draft', 'To-do', 'Completed']) {
        if (l === label) expect(box(l)).toBeChecked()
        else expect(box(l)).not.toBeChecked()
      }
      if (label === 'Completed') await expandSection('Completed')
      expect(screen.getByText(title)).toBeInTheDocument()
      expect(screen.getByText('1 task')).toBeInTheDocument()
    })

    it('deselecting every status shows all tasks', async () => {
      renderPage()
      await click('Draft')
      await click('To-do')
      await click('In Progress')
      await click('Blocked (0)')
      await click('Completed')
      await expandSection('Completed')
      for (const t of ['Draft one', 'Todo one', 'Completed one']) expect(screen.getByText(t)).toBeInTheDocument()
      expect(screen.getByText('3 tasks')).toBeInTheDocument()
    })

    it('shows the empty state and 0 tasks when only Completed tasks exist and Completed is unchecked', async () => {
      useData([mixed[2]])
      renderPage()
      await click('Completed')
      expect(screen.getByText('No tasks match your filters.')).toBeInTheDocument()
      expect(screen.getByText('0 tasks')).toBeInTheDocument()
    })

    it('resets to the default selection on remount', async () => {
      const first = renderPage()
      await click('Completed')
      await click('Draft')
      first.unmount()
      renderPage()
      expect(box('Draft')).toBeChecked()
      expect(box('To-do')).toBeChecked()
      expect(box('Completed')).toBeChecked()
    })

    it('composes with search and project filters', async () => {
      useData([...mixed, { ...baseTask, id: 24, title: 'Done in Beta', status: 'Completed', projectId: 2, projectName: 'Beta' }])
      renderPage()
      await userEvent.selectOptions(filterSelect(), 'Beta')
      await expandSection('Completed')
      expect(screen.getByText('Done in Beta')).toBeInTheDocument()
      expect(screen.queryByText('Completed one')).not.toBeInTheDocument()
      await userEvent.selectOptions(filterSelect(), 'All projects')
      await userEvent.type(screen.getByPlaceholderText(/Search title or #id/), 'Completed')
      await waitFor(() => expect(screen.queryByText('Draft one')).not.toBeInTheDocument())
      expect(screen.getByText('Completed one')).toBeInTheDocument()
      expect(screen.queryByText('Done in Beta')).not.toBeInTheDocument()
    })

    it('shows a Completed parent with an open child only as a context header', () => {
      useData([
        { ...baseTask, id: 31, title: 'Done parent', status: 'Completed', childTaskCount: 1 },
        { ...baseTask, id: 32, title: 'Open child', status: 'Todo', parentTaskItemId: 31 },
      ])
      renderPage()
      expect(rowFor('Done parent')).toHaveClass('t-context-header')
      expect(within(rowFor('Done parent')).queryByRole('button', { name: /^Status:/ })).not.toBeInTheDocument()
      expect(screen.getByText('Open child')).toBeInTheDocument()
      expect(screen.getByText('1 task')).toBeInTheDocument()
    })

    it('supports keyboard Tab and Space', async () => {
      renderPage()
      box('Blocked (0)').focus()
      await userEvent.tab()
      expect(box('Completed')).toHaveFocus()
      await userEvent.keyboard(' ')
      expect(box('Completed')).not.toBeChecked()
      expect(box('Completed')).toHaveFocus()
      expect(screen.queryByRole('button', { name: /^Completed ·/ })).not.toBeInTheDocument()
    })

    it('Completed history chip lists completed tasks while Completed is checked and is empty once it is not', async () => {
      useData([{ ...mixed[2], currentJournalDate: '2020-01-01' }])
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: 'Completed history' }))
      await expandSection('Completed')
      expect(screen.getByText('Completed one')).toBeInTheDocument()
      await click('Completed')
      expect(screen.getByText('No tasks match your filters.')).toBeInTheDocument()
    })

    it('shows an unrecognized status under the default filter, hides it once any status is unchecked and shows it when none are', async () => {
      useData([{ ...baseTask, id: 41, title: 'No status', status: undefined }, mixed[0]])
      renderPage()
      expect(screen.getByText('No status')).toBeInTheDocument()
      await click('Draft')
      expect(screen.queryByText('No status')).not.toBeInTheDocument()
      await click('Draft')
      expect(screen.getByText('No status')).toBeInTheDocument()
      for (const name of ['Draft', 'To-do', 'In Progress', 'Blocked (0)', 'Completed']) await click(name)
      expect(screen.getByText('No status')).toBeInTheDocument()
    })

    it('shows InProgress tasks (PascalCase response) under the default filter', () => {
      useData([{ ...baseTask, id: 61, title: 'Underway', status: 'InProgress' }])
      renderPage()
      expect(screen.getByText('Underway')).toBeInTheDocument()
      expect(screen.getByText('In Progress', { selector: '.t-badge-inprogress' })).toBeInTheDocument()
    })

    it('hides InProgress tasks once the In Progress filter is cleared', async () => {
      useData([{ ...baseTask, id: 61, title: 'Underway', status: 'InProgress' }, mixed[0]])
      renderPage()
      await click('In Progress')
      expect(screen.queryByText('Underway')).not.toBeInTheDocument()
    })

    it('matches status case-insensitively', () => {
      useData([{ ...baseTask, id: 51, title: 'Lower todo', status: 'todo' }])
      renderPage()
      expect(screen.getByText('Lower todo')).toBeInTheDocument()
    })

    it('moves a task into the collapsed Completed section when it becomes Completed, keeping the total', () => {
      const { rerender } = renderPage()
      expect(screen.getByText('Todo one')).toBeInTheDocument()
      expect(screen.getByText('3 tasks')).toBeInTheDocument()

      useData(mixed.map(t => (t.id === 22 ? { ...t, status: 'Completed' } : t)))
      rerender(page())

      expect(screen.queryByText('Todo one')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Completed · 2 tasks/ })).toBeInTheDocument()
      expect(screen.getByText('3 tasks')).toBeInTheDocument()
    })

    it('makes no localStorage writes while rendering and toggling every status checkbox', async () => {
      const setItem = vi.fn()
      vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem, removeItem: vi.fn(), clear: vi.fn() })
      try {
        renderPage()
        await click('Completed')
        await click('Draft')
        await click('To-do')
        expect(setItem).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('status cycle', () => {
    it('cycling a Todo task sends status inProgress and never an isComplete field', async () => {
      renderPage()
      const row = rowFor('Alpha work')
      await userEvent.click(within(row).getByRole('button', { name: /Status: To-do/i }))
      expect(taskMutations.mutate).toHaveBeenCalledTimes(1)
      const payload = taskMutations.mutate.mock.calls[0][0]
      expect(payload.id).toBe(3)
      expect(payload.data.status).toBe('inProgress')
      expect(payload.data).not.toHaveProperty('isComplete')
    })

    function useRows(rows: unknown[]) {
      vi.mocked(useTasksQuery).mockReturnValue({ data: { data: rows }, isLoading: false, error: null } as never)
    }

    it('cycling an InProgress task sends status completed', async () => {
      useRows([{ ...baseTask, id: 71, title: 'Underway', status: 'InProgress', startedAt: '2026-05-01T08:00:00Z' }])
      renderPage()
      await userEvent.click(within(rowFor('Underway')).getByRole('button', { name: /Status: In Progress/i }))
      expect(taskMutations.mutate).toHaveBeenCalledTimes(1)
      expect(taskMutations.mutate.mock.calls[0][0].data.status).toBe('completed')
    })

    it('cycling a Draft task sends todo and a Completed task sends draft', async () => {
      useRows([
        { ...baseTask, id: 72, title: 'A draft', status: 'Draft' },
        { ...baseTask, id: 73, title: 'A finished', status: 'Completed' },
      ])
      renderPage()
      await expandSection('Completed')
      await userEvent.click(within(rowFor('A draft')).getByRole('button', { name: /Status: Draft/i }))
      await userEvent.click(within(rowFor('A finished')).getByRole('button', { name: /Status: Completed/i }))
      expect(taskMutations.mutate.mock.calls[0][0].data.status).toBe('todo')
      expect(taskMutations.mutate.mock.calls[1][0].data.status).toBe('draft')
    })

    it('shows the Set-to-Todo-first message when the start is rejected with TASK_START_NOT_ALLOWED', async () => {
      taskMutations.mutate.mockImplementation((_data, { onError }: { onError: (e: unknown) => void }) =>
        onError({ code: 'TASK_START_NOT_ALLOWED' }))
      renderPage()
      await userEvent.click(within(rowFor('Alpha work')).getByRole('button', { name: /Status: To-do/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Only Todo tasks can be moved to In Progress. Set it to Todo first.',
      )
    })
  })

  describe('view chips file completed tasks by completion day (#472)', () => {
    // Thursday; the test TZ is UTC so the browser offset is 0.
    const TODAY = '2026-11-12'
    const row = (id: number, title: string, extra: Record<string, unknown>) => ({ ...baseTask, id, title, ...extra })
    const useRows = (rows: unknown[]) =>
      vi.mocked(useTasksQuery).mockReturnValue({ data: { data: rows }, isLoading: false, error: null } as never)
    const chip = (name: string) => userEvent.click(screen.getByRole('button', { name }))

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-12T12:00:00Z'))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    const rows = [
      row(1, 'Open today', { status: 'Todo', currentJournalDate: TODAY }),
      row(2, 'Open future', { status: 'Todo', currentJournalDate: '2026-11-20' }),
      row(3, 'Done today, linked earlier', { status: 'Completed', completedAt: '2026-11-12T09:00:00Z', currentJournalDate: '2026-11-05' }),
      row(4, 'Done yesterday, linked future', { status: 'Completed', completedAt: '2026-11-11T09:00:00Z', currentJournalDate: '2026-11-20' }),
      row(5, 'Done no link', { status: 'Completed', completedAt: '2026-11-03T09:00:00Z', currentJournalDate: null }),
      row(6, 'Done no completedAt, linked past', { status: 'Completed', currentJournalDate: '2026-11-02' }),
      row(7, 'Done no completedAt, linked future', { status: 'Completed', currentJournalDate: '2026-11-20' }),
    ]

    it('Active today holds open tasks linked today and no completed ones', async () => {
      useRows(rows)
      renderPage()
      await chip('Active today')
      expect(screen.getByText('Open today')).toBeInTheDocument()
      expect(screen.queryByText('Done today, linked earlier')).not.toBeInTheDocument()
      expect(screen.queryByText('Open future')).not.toBeInTheDocument()
    })

    it('Scheduled future never lists completed tasks, even ones linked to a future day', async () => {
      useRows(rows)
      renderPage()
      await chip('Scheduled future')
      expect(screen.getByText('Open future')).toBeInTheDocument()
      expect(screen.queryByText('Done yesterday, linked future')).not.toBeInTheDocument()
      expect(screen.queryByText('Done no completedAt, linked future')).not.toBeInTheDocument()
    })

    it('Completed history lists tasks completed today (<=) and by completion day, falling back to a past linked day', async () => {
      useRows(rows)
      renderPage()
      await chip('Completed history')
      await expandSection('Completed')
      expect(screen.getByText('Done today, linked earlier')).toBeInTheDocument()
      expect(screen.getByText('Done yesterday, linked future')).toBeInTheDocument()
      expect(screen.getByText('Done no link')).toBeInTheDocument()
      expect(screen.getByText('Done no completedAt, linked past')).toBeInTheDocument()
      expect(screen.queryByText('Done no completedAt, linked future')).not.toBeInTheDocument()
      expect(screen.queryByText('Open today')).not.toBeInTheDocument()
    })

    it('All shows both the Completed and Planned for badges', async () => {
      useRows(rows)
      renderPage()
      await expandSection('Completed')
      expect(within(rowFor('Done today, linked earlier')).getByText('Completed Nov 12')).toBeInTheDocument()
      expect(within(rowFor('Open future')).getByText('Planned for Nov 20')).toBeInTheDocument()
      expect(within(rowFor('Done no completedAt, linked past')).queryByText(/^Planned for|^Completed [A-Z]/)).toBeNull()
    })

    it('a Blocked task with stored Completed and completedAt counts as not completed, filed by its linked day', async () => {
      useRows([row(8, 'Blocked one', { status: 'Blocked', completedAt: '2026-11-01T09:00:00Z', currentJournalDate: TODAY })])
      renderPage()
      await chip('Completed history')
      expect(screen.queryByText('Blocked one')).not.toBeInTheDocument()
      await chip('Active today')
      await expandSection('Blocked')
      expect(screen.getByText('Blocked one')).toBeInTheDocument()
    })

    it('completing a task moves it from Active today to Completed history, and reopening moves it back', async () => {
      useRows([row(1, 'Mover', { status: 'InProgress', currentJournalDate: TODAY })])
      const view = renderPage()
      await chip('Active today')
      expect(screen.getByText('Mover')).toBeInTheDocument()

      useRows([row(1, 'Mover', { status: 'Completed', completedAt: '2026-11-12T10:00:00Z', currentJournalDate: TODAY })])
      view.rerender(page())
      expect(screen.queryByText('Mover')).not.toBeInTheDocument()
      await chip('Completed history')
      await expandSection('Completed')
      expect(screen.getByText('Mover')).toBeInTheDocument()

      useRows([row(1, 'Mover', { status: 'Todo', completedAt: null, currentJournalDate: TODAY })])
      view.rerender(page())
      expect(screen.queryByText('Mover')).not.toBeInTheDocument()
      await chip('Active today')
      expect(screen.getByText('Mover')).toBeInTheDocument()
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

    it('Edit navigates to the detail page in edit mode and opens no inline panel', async () => {
      renderPage()
      await userEvent.click(within(rowFor('Alpha work')).getByRole('button', { name: 'Edit Alpha work' }))
      expect(screen.getByTestId('location')).toHaveTextContent('/tasks/3?edit=1')
      expect(screen.queryByRole('heading', { name: 'Edit Task' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'New Task' })).not.toBeInTheDocument()
    })

    it('the title link opens the detail page in read mode, without the edit param', async () => {
      renderPage()
      await userEvent.click(within(rowFor('Alpha work')).getByRole('link', { name: 'Alpha work' }))
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/tasks\/3$/)
    })
  })

  describe('blocked tasks', () => {
    const rowsWithBlocked = [
      { ...baseTask, id: 61, title: 'Draft task', status: 'Draft' },
      { ...baseTask, id: 62, title: 'Todo task', status: 'Todo' },
      { ...baseTask, id: 63, title: 'Stuck task', status: 'Blocked', blockedReason: 'Waiting on Sam', previousStatus: 'Todo' },
      { ...baseTask, id: 64, title: 'Done task', status: 'Completed' },
    ]

    beforeEach(() => {
      vi.mocked(useTasksQuery).mockReturnValue({ data: { data: rowsWithBlocked }, isLoading: false, error: null } as never)
    })

    it('shows a Blocked chip with the count, checked by default; the Blocked section starts collapsed', async () => {
      renderPage()
      const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Blocked (1)' })
      expect(box).toBeChecked()
      expect(screen.queryByText('Stuck task')).not.toBeInTheDocument()
      await expandSection('Blocked')
      expect(screen.getByText('Stuck task')).toBeInTheDocument()
      expect(screen.queryByText('Done task')).not.toBeInTheDocument()
    })

    it('unchecking Blocked hides blocked tasks', async () => {
      renderPage()
      await expandSection('Blocked')
      expect(screen.getByText('Stuck task')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('checkbox', { name: 'Blocked (1)' }))
      expect(screen.queryByText('Stuck task')).not.toBeInTheDocument()
    })

    it('Draft rows have no Block button; Todo rows do', () => {
      renderPage()
      expect(within(rowFor('Draft task')).queryByRole('button', { name: /^Block task/ })).not.toBeInTheDocument()
      expect(within(rowFor('Todo task')).getByRole('button', { name: 'Block task: Todo task' })).toBeInTheDocument()
    })

    it('blocking a Todo row sends id and trimmed reason through the block mutation', async () => {
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: 'Block task: Todo task' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Blocked reason, optional' }), ' Waiting {Enter}')
      expect(blockAsync).toHaveBeenCalledWith({ id: 62, reason: 'Waiting' })
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Task blocked: Todo task'))
    })

    it('a failed block shows a plain-language alert and re-opens the input with the typed text', async () => {
      blockAsync.mockRejectedValueOnce({ code: 'TASK_BLOCK_DRAFT_NOT_ALLOWED' })
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: 'Block task: Todo task' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Blocked reason, optional' }), 'Waiting{Enter}')
      expect(await screen.findByRole('alert')).toHaveTextContent('Only Todo or In Progress tasks can be blocked.')
      expect(await screen.findByRole('textbox', { name: 'Blocked reason, optional' })).toHaveValue('Waiting')
    })

    it('the Unblock badge unblocks the task', async () => {
      renderPage()
      await expandSection('Blocked')
      await userEvent.click(screen.getByRole('button', { name: 'Unblock task: Stuck task' }))
      expect(unblockMutate).toHaveBeenCalledWith({ id: 63 }, expect.any(Object))
    })

    it('a failed unblock shows an alert', async () => {
      unblockMutate.mockImplementation((_vars, opts: { onError: (e: unknown) => void }) => opts.onError({}))
      renderPage()
      await expandSection('Blocked')
      await userEvent.click(screen.getByRole('button', { name: 'Unblock task: Stuck task' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save task changes.')
    })

    it('editing the reason sends a reason-only mutation', async () => {
      renderPage()
      await expandSection('Blocked')
      await userEvent.dblClick(screen.getByText('Waiting on Sam'))
      const input = screen.getByRole('textbox', { name: 'Blocked reason, optional' })
      await userEvent.clear(input)
      await userEvent.type(input, 'Other{Enter}')
      expect(editReasonAsync).toHaveBeenCalledWith({ id: 63, reason: 'Other' })
    })

    it('clicking the status badge of a Blocked row does not cycle it', async () => {
      renderPage()
      await expandSection('Blocked')
      await userEvent.click(screen.getByRole('button', { name: 'Unblock task: Stuck task' }))
      expect(taskMutations.mutate).not.toHaveBeenCalled()
      expect(unblockMutate).toHaveBeenCalledTimes(1)
    })

    it('a parent with only completed subtasks is a work row that reports their progress', () => {
      vi.mocked(useTasksQuery).mockReturnValue({
        data: {
          data: [
            { ...baseTask, id: 71, title: 'Parent', status: 'Todo', childTaskCount: 1 },
            { ...baseTask, id: 72, title: 'Kid done', status: 'Completed', parentTaskItemId: 71 },
          ],
        },
        isLoading: false,
        error: null,
      } as never)
      renderPage()
      expect(within(rowFor('Parent')).getByText('1/1 subtasks complete')).toBeInTheDocument()
    })

    it('sorts a parent block by the parent derived status, not its stored one', () => {
      vi.mocked(usePrefs).mockReturnValue({ ...vi.mocked(usePrefs)(), taskSortKey: 'status', taskSortDir: 'asc' })
      vi.mocked(useTasksQuery).mockReturnValue({
        data: {
          data: [
            // Stored Draft would rank the parent block before the Todo sibling; the In Progress child derives it to In Progress.
            { ...baseTask, id: 91, title: 'Derived parent', status: 'Draft', childTaskCount: 2 },
            { ...baseTask, id: 92, title: 'Active child', status: 'InProgress', parentTaskItemId: 91 },
            { ...baseTask, id: 93, title: 'Todo child', status: 'Todo', parentTaskItemId: 91 },
            { ...baseTask, id: 94, title: 'Todo sibling', status: 'Todo' },
          ],
        },
        isLoading: false,
        error: null,
      } as never)
      renderPage()
      const order = Array.from(document.querySelectorAll('.t-task-link')).map(n => n.textContent)
      expect(order.indexOf('Todo sibling')).toBeGreaterThan(-1)
      expect(order.indexOf('Todo sibling')).toBeLessThan(order.indexOf('Todo child'))
    })

    it('a parent with a blocked subtask is only a context header', async () => {
      vi.mocked(useTasksQuery).mockReturnValue({
        data: {
          data: [
            { ...baseTask, id: 71, title: 'Parent', status: 'Todo', childTaskCount: 1 },
            { ...baseTask, id: 73, title: 'Kid blocked', status: 'Blocked', parentTaskItemId: 71 },
          ],
        },
        isLoading: false,
        error: null,
      } as never)
      renderPage()
      await expandSection('Blocked')
      expect(rowFor('Parent')).toHaveClass('t-context-header')
      expect(screen.getByText('Kid blocked')).toBeInTheDocument()
    })

    it('lists Blocked after the priority sections, then Draft, then Completed', async () => {
      renderPage()
      await expandSection('Blocked')
      await expandSection('Completed')
      const order = Array.from(document.querySelectorAll('.t-task-link')).map(n => n.textContent)
      expect(order).toEqual(['Todo task', 'Stuck task', 'Draft task', 'Done task'])
    })

    it('does not cycle an unknown status', async () => {
      vi.mocked(useTasksQuery).mockReturnValue({
        data: { data: [{ ...baseTask, id: 81, title: 'Odd', status: 'Mystery' }] },
        isLoading: false,
        error: null,
      } as never)
      renderPage()
      await userEvent.click(within(rowFor('Odd')).getByRole('button', { name: /Status: mystery/i }))
      expect(taskMutations.mutate).not.toHaveBeenCalled()
    })
  })
})
