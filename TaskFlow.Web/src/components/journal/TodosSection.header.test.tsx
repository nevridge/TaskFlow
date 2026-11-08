import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import userEvent from '@testing-library/user-event'
import type { TaskItemResponseDto } from '@/api/journal'

const createTodoMutate = vi.fn()
const toggleTodoMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: {
    all: ['journal'],
    todos: (id: number) => ['journal', id, 'todos'],
    notes: (id: number) => ['journal', id, 'notes'],
  },
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: createTodoMutate, isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
  useEditTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status === 'Blocked').length),
}))

vi.mock('@/api/journal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/journal')>()),
  removeJournalTodo: vi.fn(() => Promise.resolve({})),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({ TaskHistoryPanel: () => null }))

vi.mock('@/lib/journal-utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return { ...actual, todayISO: vi.fn(() => '2026-05-28') }
})

import { useJournalTodos } from '@/hooks/useJournal'
import { removeJournalTodo } from '@/api/journal'
import { TodosSection } from './TodosSection'

const DAY = '2026-05-28'
const NOW_ISO = new Date().toISOString()

function row(overrides: Partial<TaskItemResponseDto>): TaskItemResponseDto {
  return { id: 1, title: 'Task', status: 'Todo', priority: 'low', description: null, dueDate: null, ...overrides } as TaskItemResponseDto
}

const parent = (extra: Partial<TaskItemResponseDto> = {}) => row({ id: 1, title: 'Parent', openChildCount: 2, childTaskCount: 2, ...extra })
const sub = (id: number, extra: Partial<TaskItemResponseDto> = {}) => row({ id, title: `Sub ${id}`, parentTaskItemId: 1, ...extra })

function load(rows: TaskItemResponseDto[]) {
  vi.mocked(useJournalTodos).mockReturnValue({ data: { data: rows }, isLoading: false } as never)
}

const renderSection = (sort: 'manual' | 'open first' = 'manual') =>
  render(<TodosSection entryId={10} isoDate={DAY} sort={sort} />)

describe('TodosSection context headers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toggleTodoMutate.mockReset()
    createTodoMutate.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('renders a parent with open subtasks as a header link with progress and no row controls', () => {
    load([parent(), sub(2), sub(3, { status: 'Completed' })])
    renderSection()
    const link = screen.getByRole('link', { name: /^Parent task/ })
    expect(link).toHaveAttribute('href', '/tasks/1')
    expect(link).toHaveTextContent('Parent task: Parent')
    const header = link.closest('li') as HTMLElement
    expect(header).toHaveClass('todo-context-header')
    expect(header).toHaveTextContent('1/2 subtasks complete')
    expect(within(header).queryByRole('button')).toBeNull()
    expect(header.querySelector('input, [data-todo-check], .todo-id')).toBeNull()
    expect(screen.queryByText('Parent', { selector: '.todo-text' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove from day: Parent/ })).not.toBeInTheDocument()
  })

  it('shows no future badge and no disabled remove button for subtask rows', () => {
    load([parent(), sub(2, { currentJournalDate: '2026-06-20' })])
    renderSection()
    expect(screen.queryByText('Jun 20')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove from day' })).toBeEnabled()
  })

  it('describes each subtask remove button by the parent title without changing its accessible name', () => {
    load([parent(), sub(2)])
    renderSection()
    const remove = screen.getByRole('button', { name: 'Remove from day' })
    expect(remove).toHaveAccessibleDescription('Parent')
  })

  it('shows a parent as a normal row with a checkbox and no header when no subtask is a row of the day', () => {
    load([parent()])
    renderSection()
    expect(screen.getByText('Parent', { selector: '.todo-text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Parent task/ })).not.toBeInTheDocument()
  })

  it('shows a Completed parent with Completed subtasks as a done row plus a header, subtasks after the header', () => {
    const done = row({ id: 1, title: 'Shipped', status: 'Completed', completedAt: NOW_ISO, currentJournalDate: DAY, childTaskCount: 2 })
    load([done, sub(2, { status: 'Completed', completedAt: NOW_ISO }), sub(3, { status: 'Completed', completedAt: NOW_ISO })])
    renderSection()
    const parentLi = screen.getByText('Shipped', { selector: '.todo-text' }).closest('li') as HTMLElement
    expect(parentLi).toHaveClass('is-done')
    expect(parentLi).not.toHaveClass('todo-in-group')
    const header = screen.getByRole('link', { name: /^Parent task/ }).closest('li') as HTMLElement
    expect(header).toHaveTextContent('2/2 subtasks complete')
    expect(parentLi.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(header.nextElementSibling).toBe(screen.getByText('Sub 2').closest('li'))
    expect(screen.getByText('Sub 2').closest('li')).toHaveClass('todo-in-group')
  })

  it('builds a header from parentTitle for a subtask whose parent is not on the day, without an arrow prefix', () => {
    load([sub(2, { parentTaskItemId: 77, parentTitle: 'Elsewhere parent' })])
    renderSection()
    expect(screen.getByRole('link', { name: /^Parent task/ })).toHaveAttribute('href', '/tasks/77')
    expect(document.body.textContent).not.toContain('↳')
    expect(screen.getByText('Sub 2')).toBeInTheDocument()
  })

  it('counts only work rows: a header and two subtask rows make a total of 2', () => {
    load([parent(), sub(2), sub(3, { status: 'Blocked', blockedReason: 'r' })])
    renderSection()
    expect(screen.getByText('0/2', { selector: '.todo-count' })).toBeInTheDocument()
    expect(screen.getByText('· 1 blocked')).toBeInTheDocument()
  })

  it('keeps the completed subtask row in place, updates the header count in place, and shows the parent as a row', () => {
    load([parent({ openChildCount: 1 }), sub(2)])
    const { rerender } = renderSection()
    const check = screen.getByRole('button', { name: 'Mark done' })
    check.focus()
    expect(screen.getByRole('link', { name: /^Parent task/ }).closest('li')).toHaveTextContent('0/1 subtasks complete')

    // Optimistic completion: the flat cache flips the row; the parent's openChildCount refreshes later.
    load([parent({ openChildCount: 1 }), sub(2, { status: 'Completed', completedAt: NOW_ISO })])
    rerender(<TodosSection entryId={10} isoDate={DAY} sort="manual" />)

    expect(screen.getByRole('link', { name: /^Parent task/ }).closest('li')).toHaveTextContent('1/1 subtasks complete')
    const done = screen.getByRole('button', { name: 'Mark not done' })
    expect(done).toBe(check)
    expect(done).toHaveFocus()
    // The parent is no longer suppressed: it is a normal row (and keeps a header for its subtask row).
    expect(screen.getByText('Parent', { selector: '.todo-text' })).toBeInTheDocument()
  })

  it('shows the server message and keeps the subtask checked state when a reopen is rejected (#396)', async () => {
    const done = row({ id: 1, title: 'Shipped', status: 'Completed', currentJournalDate: DAY, childTaskCount: 1 })
    const child = sub(2, { status: 'Completed', completedAt: NOW_ISO })
    load([done, child])
    toggleTodoMutate.mockImplementation((_v, opts) => opts.onError({ code: 'TASK_PARENT_COMPLETED_NOT_ALLOWED' }))
    renderSection()
    const childCheck = document.querySelector('[data-todo-check="2"]') as HTMLElement
    childCheck.focus()
    await userEvent.click(childCheck)
    expect(toggleTodoMutate).toHaveBeenCalledWith(
      { id: 2, done: false, autoCompleteParentWhenChildrenDone: false },
      expect.any(Object),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/completed task can't have open subtasks/i)
    expect(childCheck).toHaveFocus()
    // The row stays checked: the optimistic change never happened and the text is unchanged.
    expect(childCheck).toHaveAttribute('aria-label', 'Mark not done')
  })

  it.each([
    ['TASK_PLAN_HAS_OPEN_SUBTASKS', 'This task has open subtasks. Plan the subtasks instead.'],
    ['TASK_PARENT_STATUS_DERIVED', "This task's status follows its subtasks. Change a subtask instead."],
  ])('shows the %s message in an alert from the code alone (no journalDate)', async (code, message) => {
    load([])
    createTodoMutate.mockImplementation((_t, opts) => opts.onError({ code, details: { taskItemId: 1, journalDate: null } }))
    renderSection()
    await userEvent.type(screen.getByPlaceholderText('Add a TODO and press Enter'), 'Plan it{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent(message)
  })

  it('shows the derived-status message when a toggle is rejected with TASK_PARENT_STATUS_DERIVED', async () => {
    load([row({ id: 4, title: 'Lone' })])
    toggleTodoMutate.mockImplementation((_v, opts) => opts.onError({ code: 'TASK_PARENT_STATUS_DERIVED' }))
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(screen.getByRole('alert')).toHaveTextContent("This task's status follows its subtasks. Change a subtask instead.")
  })

  it('tabs through a cluster: header link once, then the row controls in order; headers are never check targets', async () => {
    load([parent(), sub(2), sub(3)])
    renderSection()
    const user = userEvent.setup()
    const section = document.querySelector('section.todos') as HTMLElement
    const stops: string[] = []
    for (let i = 0; i < 4; i++) {
      await user.tab()
      const el = document.activeElement as HTMLElement
      stops.push(el.tagName === 'A' ? 'link' : (el.getAttribute('data-todo-check') ? `check${el.getAttribute('data-todo-check')}` : (el.getAttribute('aria-label') ?? el.tagName)))
      if (!section.contains(el)) break
    }
    expect(stops[0]).toBe('link')
    expect(stops.filter(s => s === 'link')).toHaveLength(1)
    expect(stops[1]).toBe('check2')
  })

  describe('undo-pending hiding', () => {
    it('removes the header in the same render when its last subtask row is hidden, and shows "No TODOs yet"', () => {
      load([sub(2, { parentTaskItemId: 77, parentTitle: 'Elsewhere parent' })])
      renderSection()
      expect(screen.getByRole('link', { name: /^Parent task/ })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Remove from day' }))
      expect(screen.queryByRole('link', { name: /^Parent task/ })).not.toBeInTheDocument()
      expect(screen.getByText(/no todos yet/i)).toBeInTheDocument()
      // Focus fell back to the draft input, not a header
      expect(screen.getByPlaceholderText('Add a TODO and press Enter')).toHaveFocus()
    })

    it('shows the parent as a normal row once its only visible subtask is hidden', () => {
      load([parent({ openChildCount: 1 }), sub(2)])
      renderSection()
      fireEvent.click(screen.getByRole('button', { name: 'Remove from day' }))
      expect(screen.queryByRole('link', { name: /^Parent task/ })).not.toBeInTheDocument()
      expect(screen.getByText('Parent', { selector: '.todo-text' })).toBeInTheDocument()
      expect(screen.queryByText(/no todos yet/i)).not.toBeInTheDocument()
    })

    it('moves focus to the next work row remove button, skipping headers', () => {
      load([sub(2, { parentTaskItemId: 77, parentTitle: 'A' }), sub(3, { parentTaskItemId: 88, parentTitle: 'B' })])
      renderSection()
      fireEvent.click(document.querySelector('[data-todo-x="2"]') as HTMLElement)
      expect(document.querySelector('[data-todo-x="3"]')).toHaveFocus()
    })

    it('removing a parent row hides only that row, never its subtasks (no optimistic child removal)', () => {
      const stale = row({ id: 1, title: 'Parent', openChildCount: 0, childTaskCount: 1 })
      load([stale, sub(2, { status: 'Completed' })])
      renderSection()
      fireEvent.click(screen.getByRole('button', { name: 'Remove from day: Parent' }))
      expect(screen.getByText('Sub 2')).toBeInTheDocument()
      expect(removeJournalTodo).not.toHaveBeenCalled()
    })
  })
})
