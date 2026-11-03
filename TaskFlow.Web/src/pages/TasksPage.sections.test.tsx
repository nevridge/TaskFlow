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

function page() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
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
const succeedWith = (id: number) =>
  taskMutations.mutate.mockImplementation((_data, { onSuccess }: { onSuccess: (r: unknown) => void }) =>
    onSuccess({ data: { id } }))

describe('TasksPage sections and context headers (#384)', () => {
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

  const everyStatus = [
    { ...baseTask, id: 1, title: 'Doing', status: 'InProgress', priority: 'Low' },
    { ...baseTask, id: 2, title: 'Urgent', status: 'Todo', priority: 'High' },
    { ...baseTask, id: 3, title: 'Normal', status: 'Todo', priority: 'Medium' },
    { ...baseTask, id: 4, title: 'Minor', status: 'Todo', priority: 'Low' },
    { ...baseTask, id: 5, title: 'Stuck', status: 'Blocked', priority: 'High' },
    { ...baseTask, id: 6, title: 'Idea', status: 'Draft', priority: 'High' },
    { ...baseTask, id: 7, title: 'Finished', status: 'Completed', priority: 'High' },
  ]

  it('renders the sections in order, with Blocked and Completed collapsed and counts of work rows', () => {
    useData(everyStatus)
    renderPage()
    expect(sectionToggles()).toEqual(['inProgress', 'high', 'medium', 'low', 'blocked', 'draft', 'completed'])
    for (const key of ['inProgress', 'high', 'medium', 'low', 'draft']) {
      expect(toggleOf(key)).toHaveAttribute('aria-expanded', 'true')
    }
    expect(toggleOf('blocked')).toHaveAttribute('aria-expanded', 'false')
    expect(toggleOf('completed')).toHaveAttribute('aria-expanded', 'false')
    expect(toggleOf('completed')).toHaveAccessibleName('Completed · 1 task')
    expect(screen.getByText('7 tasks')).toBeInTheDocument()
    expect(screen.queryByText('Stuck')).not.toBeInTheDocument()
    expect(screen.queryByText('Finished')).not.toBeInTheDocument()
  })

  it('writes the collapse choice only when a section is toggled', async () => {
    useData(everyStatus)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderPage()
    expect(setItem).not.toHaveBeenCalled()
    await userEvent.click(toggleOf('completed'))
    expect(toggleOf('completed')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Finished')).toBeInTheDocument()
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  const family = [
    { ...baseTask, id: 1, title: 'Goal', status: 'Todo', priority: 'High', childTaskCount: 2 },
    { ...baseTask, id: 2, title: 'Mid kid', status: 'Todo', priority: 'High', parentTaskItemId: 1 },
    { ...baseTask, id: 3, title: 'Low kid', status: 'Todo', priority: 'Low', parentTaskItemId: 1 },
  ]

  it('a context header links the nearest parent to its detail page and offers only Add subtask', () => {
    useData(family)
    renderPage()
    const headers = document.querySelectorAll<HTMLElement>('.t-context-header')
    expect(headers).toHaveLength(2)
    for (const header of headers) {
      expect(within(header).getByRole('link', { name: 'Goal' })).toHaveAttribute('href', '/tasks/1')
      expect(within(header).getAllByRole('button')).toHaveLength(1)
      expect(
        header.querySelector('[data-task-status-id], [data-task-edit-id], [data-task-delete-id], [aria-expanded]'),
      ).toBeNull()
    }
    expect(screen.getAllByRole('button', { name: 'Add subtask to Goal' })).toHaveLength(2)
    expect(document.querySelector('[data-task-edit-id="1"]')).toBeNull()
  })

  it('shows upper path segments as plain text and only the nearest parent as a link', () => {
    useData([
      { ...baseTask, id: 1, title: 'Goal', status: 'Todo', priority: 'High' },
      { ...baseTask, id: 2, title: 'Middle', status: 'Todo', priority: 'High', parentTaskItemId: 1 },
      { ...baseTask, id: 3, title: 'Leaf', status: 'Todo', priority: 'High', parentTaskItemId: 2 },
    ])
    renderPage()
    const header = document.querySelector<HTMLElement>('.t-context-header') as HTMLElement
    expect(within(header).getByText('Goal')).not.toHaveAttribute('href')
    expect(within(header).queryByRole('link', { name: 'Goal' })).not.toBeInTheDocument()
    expect(within(header).getByRole('link', { name: 'Middle' })).toHaveAttribute('href', '/tasks/2')
  })

  it('opens one editor directly under the clicked header; Escape and Cancel return focus to that button', async () => {
    useData(family)
    renderPage()
    const buttons = screen.getAllByRole('button', { name: 'Add subtask to Goal' })
    await userEvent.click(buttons[1])
    const inputs = screen.getAllByPlaceholderText('Enter subtask title')
    expect(inputs).toHaveLength(1)
    const header = buttons[1].closest('tr') as HTMLElement
    expect(header.nextElementSibling).toContainElement(inputs[0])
    expect(inputs[0]).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByPlaceholderText('Enter subtask title')).not.toBeInTheDocument()
    expect(buttons[1]).toHaveFocus()

    await userEvent.click(buttons[0])
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(buttons[0]).toHaveFocus()
  })

  it('Add subtask from a work row opens one editor under that row', async () => {
    useData([{ ...baseTask, id: 8, title: 'Solo', status: 'Todo', priority: 'High' }])
    renderPage()
    const row = rowFor('Solo')
    await userEvent.click(within(row).getByRole('button', { name: 'Add subtask' }))
    const input = screen.getByPlaceholderText('Enter subtask title')
    expect(screen.getAllByPlaceholderText('Enter subtask title')).toHaveLength(1)
    expect(row.nextElementSibling).toContainElement(input)
    await userEvent.type(input, 'Child{Enter}')
    expect(taskMutations.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Child', parentTaskItemId: 8, status: 'todo' }),
      expect.any(Object),
    )
  })

  it('a failed Add keeps the editor open and shows the error', async () => {
    useData(family)
    taskMutations.mutate.mockImplementation((_data, { onError }: { onError: (e: unknown) => void }) =>
      onError({ message: 'x' }))
    renderPage()
    await userEvent.click(screen.getAllByRole('button', { name: 'Add subtask to Goal' })[0])
    await userEvent.type(screen.getByPlaceholderText('Enter subtask title'), 'New one{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save task changes')
    expect(screen.getByPlaceholderText('Enter subtask title')).toHaveValue('New one')
  })

  it('after an Add from a header, focus stays on that header button and the landing section is announced', async () => {
    useData(family)
    succeedWith(99)
    const { rerender } = renderPage()
    await userEvent.click(screen.getAllByRole('button', { name: 'Add subtask to Goal' })[0])
    await userEvent.type(screen.getByPlaceholderText('Enter subtask title'), 'Fresh{Enter}')
    expect(screen.queryByPlaceholderText('Enter subtask title')).not.toBeInTheDocument()
    useData([...family, { ...baseTask, id: 99, title: 'Fresh', status: 'Todo', priority: 'Medium', parentTaskItemId: 1 }])
    rerender(page())
    expect(screen.getByRole('status')).toHaveTextContent('Subtask added under Goal in Medium Priority')
    expect(screen.getAllByRole('button', { name: 'Add subtask to Goal' })[0]).toHaveFocus()
  })

  it('after an Add that turns the parent header-only, focus falls back to the new subtask status control', async () => {
    const solo = { ...baseTask, id: 8, title: 'Solo', status: 'Todo', priority: 'High' }
    useData([solo])
    succeedWith(99)
    const { rerender } = renderPage()
    await userEvent.click(within(rowFor('Solo')).getByRole('button', { name: 'Add subtask' }))
    await userEvent.type(screen.getByPlaceholderText('Enter subtask title'), 'Fresh{Enter}')
    useData([solo, { ...baseTask, id: 99, title: 'Fresh', status: 'Todo', priority: 'Medium', parentTaskItemId: 8 }])
    rerender(page())
    expect(rowFor('Solo')).toHaveClass('t-context-header')
    expect(document.querySelector('[data-task-status-id="99"]')).toHaveFocus()
  })

  it('after an Add into a collapsed section, focus goes to that section toggle without expanding it', async () => {
    const solo = { ...baseTask, id: 8, title: 'Solo', status: 'Todo', priority: 'High' }
    const mid = { ...baseTask, id: 9, title: 'Mid one', status: 'Todo', priority: 'Medium' }
    useData([solo, mid])
    succeedWith(99)
    const { rerender } = renderPage()
    await userEvent.click(toggleOf('medium'))
    expect(toggleOf('medium')).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(within(rowFor('Solo')).getByRole('button', { name: 'Add subtask' }))
    await userEvent.type(screen.getByPlaceholderText('Enter subtask title'), 'Fresh{Enter}')
    useData([solo, mid, { ...baseTask, id: 99, title: 'Fresh', status: 'Todo', priority: 'Medium', parentTaskItemId: 8 }])
    rerender(page())
    expect(toggleOf('medium')).toHaveFocus()
    expect(toggleOf('medium')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('Subtask added under Solo in Medium Priority')
  })

  it('a parent shown as a work row and as a header has no duplicate row controls', async () => {
    useData([
      { ...baseTask, id: 1, title: 'Parent', status: 'Todo', priority: 'High', childTaskCount: 1 },
      { ...baseTask, id: 2, title: 'Done kid', status: 'Completed', priority: 'High', parentTaskItemId: 1 },
    ])
    renderPage()
    await userEvent.click(toggleOf('completed'))
    expect(document.querySelectorAll('[data-task-edit-id="1"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-task-delete-id="1"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-task-status-id="1"]')).toHaveLength(1)
    // The row Add subtask and the header Add subtask carry different anchors.
    const anchors = Array.from(document.querySelectorAll('[data-add-child-anchor]')).map(
      el => el.getAttribute('data-add-child-anchor'),
    )
    expect(new Set(anchors).size).toBe(anchors.length)
    await userEvent.click(within(rowFor('Done kid')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Edit Task')).toBeInTheDocument()
  })

  it('a subtask whose parent is missing from the list is a standalone row', () => {
    useData([{ ...baseTask, id: 5, title: 'Orphan', status: 'Todo', priority: 'High', parentTaskItemId: 404 }])
    renderPage()
    expect(screen.getByText('Orphan')).toBeInTheDocument()
    expect(document.querySelector('.t-context-header')).toBeNull()
  })

  it('does not loop on a cyclic parent chain', () => {
    useData([
      { ...baseTask, id: 1, title: 'A', status: 'Todo', priority: 'High', parentTaskItemId: 2 },
      { ...baseTask, id: 2, title: 'B', status: 'Todo', priority: 'High', parentTaskItemId: 1 },
    ])
    expect(() => renderPage()).not.toThrow()
  })

  it('a search that matches a parent title lists its subtasks under the header', async () => {
    useData([
      { ...baseTask, id: 1, title: 'Plan the trip', status: 'Todo', priority: 'High' },
      { ...baseTask, id: 2, title: 'Book flights', status: 'Todo', priority: 'High', parentTaskItemId: 1 },
      { ...baseTask, id: 3, title: 'Unrelated', status: 'Todo', priority: 'High' },
    ])
    renderPage()
    await userEvent.type(screen.getByPlaceholderText('Search tasks...'), 'trip')
    await waitFor(() => expect(screen.queryByText('Unrelated')).not.toBeInTheDocument())
    expect(screen.getByText('Book flights')).toBeInTheDocument()
    expect(rowFor('Plan the trip')).toHaveClass('t-context-header')
  })

  it('the project filter keeps a parent from another project as a header', async () => {
    useData([
      { ...baseTask, id: 1, title: 'Outside parent', status: 'Todo', priority: 'High', projectId: 2, projectName: 'Beta' },
      { ...baseTask, id: 2, title: 'Inside kid', status: 'Todo', priority: 'High', parentTaskItemId: 1, projectId: 1, projectName: 'Alpha' },
    ])
    renderPage()
    await userEvent.selectOptions(filterSelect(), 'Alpha')
    expect(screen.getByText('Inside kid')).toBeInTheDocument()
    expect(rowFor('Outside parent')).toHaveClass('t-context-header')
  })

  it('writes nothing to storage on filter changes (status, project, view, search)', async () => {
    useData([
      ...everyStatus,
      { ...baseTask, id: 20, title: 'Alpha thing', status: 'Todo', priority: 'High', projectId: 1, projectName: 'Alpha' },
    ])
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderPage()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
    await userEvent.selectOptions(filterSelect(), 'Alpha')
    await userEvent.click(screen.getByRole('button', { name: 'Active today' }))
    await userEvent.type(screen.getByPlaceholderText('Search tasks...'), 'thing')
    await waitFor(() => expect(screen.getByPlaceholderText('Search tasks...')).toHaveValue('thing'))
    expect(setItem).not.toHaveBeenCalled()
  })

  it('a status filter that hides a parent\'s open subtask does not turn the parent into a work row', async () => {
    useData([
      { ...baseTask, id: 1, title: 'Parent', status: 'Todo', priority: 'High' },
      { ...baseTask, id: 2, title: 'Draft kid', status: 'Draft', priority: 'High', parentTaskItemId: 1 },
      { ...baseTask, id: 3, title: 'Other', status: 'Todo', priority: 'High' },
    ])
    renderPage()
    expect(rowFor('Parent')).toHaveClass('t-context-header')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
    expect(screen.queryByText('Draft kid')).not.toBeInTheDocument()
    expect(screen.queryByText('Parent')).not.toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('a parent-title search shows nothing for the parent once a status filter excludes all its open subtasks', async () => {
    useData([
      { ...baseTask, id: 1, title: 'Plan the trip', status: 'Todo', priority: 'High' },
      { ...baseTask, id: 2, title: 'Book flights', status: 'Draft', priority: 'High', parentTaskItemId: 1 },
    ])
    renderPage()
    await userEvent.type(screen.getByPlaceholderText('Search tasks...'), 'trip')
    await waitFor(() => expect(screen.getByText('Book flights')).toBeInTheDocument())
    expect(rowFor('Plan the trip')).toHaveClass('t-context-header')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
    expect(screen.queryByText('Book flights')).not.toBeInTheDocument()
    expect(screen.queryByText('Plan the trip')).not.toBeInTheDocument()
    expect(screen.getByText('No tasks match your filters.')).toBeInTheDocument()
  })

  it('tabs from a header link to its Add subtask button and then into the block rows', async () => {
    useData(family)
    renderPage()
    const header = document.querySelector<HTMLElement>('.t-context-header') as HTMLElement
    within(header).getByRole('link', { name: 'Goal' }).focus()
    await userEvent.tab()
    expect(within(header).getByRole('button', { name: 'Add subtask to Goal' })).toHaveFocus()
    await userEvent.tab()
    expect(rowFor('Mid kid').contains(document.activeElement)).toBe(true)
  })

  it('renders no context header or rows inside a collapsed section, and its toggle shows the work-row count', () => {
    useData([
      { ...baseTask, id: 1, title: 'Goal', status: 'Todo', priority: 'High' },
      { ...baseTask, id: 2, title: 'Stuck kid', status: 'Blocked', priority: 'High', parentTaskItemId: 1 },
    ])
    renderPage()
    expect(toggleOf('blocked')).toHaveAttribute('aria-expanded', 'false')
    expect(toggleOf('blocked')).toHaveAccessibleName('Blocked · 1 task')
    expect(document.querySelector('.t-context-header')).toBeNull()
    expect(screen.queryByText('Stuck kid')).not.toBeInTheDocument()
    expect(document.querySelector('[data-task-status-id]')).toBeNull()
  })

  it('a Todo task with no priority lands in High', () => {
    useData([{ ...baseTask, id: 1, title: 'No priority', status: 'Todo', priority: undefined }])
    renderPage()
    expect(toggleOf('high')).toHaveAccessibleName('High Priority · 1 task')
  })
})
