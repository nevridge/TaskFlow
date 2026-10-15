import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TodosSectionHandle } from './TodosSection'
import type { TaskItemResponseDto } from '@/api/journal'

const createTodoMutate = vi.fn()
const toggleTodoMutate = vi.fn()
const editTodoMutate = vi.fn()
const removeTodoMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: createTodoMutate, isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
  useEditTodoMutation: vi.fn(() => ({ mutate: editTodoMutate, isPending: false })),
  useRemoveTodoMutation: vi.fn(() => ({ mutate: removeTodoMutate, isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel" />,
}))

vi.mock('@/lib/journal-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return {
    ...actual,
    todayISO: vi.fn(() => '2026-05-28'),
  }
})

import { useJournalTodos } from '@/hooks/useJournal'
import { todayISO } from '@/lib/journal-utils'
import { TodosSection } from './TodosSection'

const openTodo: TaskItemResponseDto = {
  id: 1,
  title: 'Write tests',
  status: 'Todo',
  isComplete: false,
  priority: 'low',
  description: null,
  dueDate: null,
}

const doneTodo: TaskItemResponseDto = {
  id: 2,
  title: 'Fix bug',
  status: 'Completed',
  isComplete: false,
  priority: 'low',
  description: null,
  dueDate: null,
}

function renderSection(props?: Partial<{ entryId: number; isoDate: string; sort: 'manual' | 'open first' | 'done last' }>, ref?: React.Ref<TodosSectionHandle>) {
  const { entryId = 10, isoDate = '2026-05-28', sort = 'manual' } = props ?? {}
  return render(<TodosSection ref={ref} entryId={entryId} isoDate={isoDate} sort={sort} />)
}

describe('TodosSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toggleTodoMutate.mockReset()
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(todayISO).mockReturnValue('2026-05-28')
  })

  it('shows loading state', () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: undefined, isLoading: true } as never)
    renderSection()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows empty state', () => {
    renderSection()
    expect(screen.getByText(/no todos yet/i)).toBeInTheDocument()
  })

  it('renders two todos', () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo, doneTodo] }, isLoading: false } as never)
    renderSection()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('Fix bug')).toBeInTheDocument()
  })

  it('todo with status Completed gets is-done class on li', () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [doneTodo] }, isLoading: false } as never)
    renderSection()
    const li = screen.getByText('Fix bug').closest('li')
    expect(li?.className).toContain('is-done')
  })

  it('todo with lowercase status "completed" does NOT get is-done class', () => {
    const lowercaseDone: TaskItemResponseDto = { ...openTodo, id: 3, title: 'lowercase', status: 'completed' as never, isComplete: false }
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [lowercaseDone] }, isLoading: false } as never)
    renderSection()
    const li = screen.getByText('lowercase').closest('li')
    expect(li?.className).not.toContain('is-done')
  })

  it('toggle button calls toggleTodo.mutate', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /mark done/i }))
    expect(toggleTodoMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, title: 'Write tests', done: true }),
      expect.any(Object)
    )
  })

  it('toggle rejected with TASK_REOPEN_PAST_DAY_NOT_ALLOWED shows the past-days message and task stays completed', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [doneTodo] }, isLoading: false } as never)
    toggleTodoMutate.mockImplementation((_vars, opts) => opts.onError({ code: 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED' }))
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /mark not done/i }))
    expect(screen.getByText('Completed tasks assigned to past days cannot be reopened.')).toBeInTheDocument()
    expect(screen.getByText('Fix bug').closest('li')?.className).toContain('is-done')
  })

  it('toggle rejected with an unrelated error shows the generic message', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    toggleTodoMutate.mockImplementation((_vars, opts) => opts.onError(new Error('boom')))
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /mark done/i }))
    expect(screen.getByText('Unable to save task changes. Please try again.')).toBeInTheDocument()
  })

  it('a successful toggle after an error clears the error message', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    toggleTodoMutate.mockImplementationOnce((_vars, opts) => opts.onError(new Error('boom')))
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /mark done/i }))
    expect(screen.getByText('Unable to save task changes. Please try again.')).toBeInTheDocument()
    toggleTodoMutate.mockImplementation(() => undefined)
    await userEvent.click(screen.getByRole('button', { name: /mark done/i }))
    expect(screen.queryByText('Unable to save task changes. Please try again.')).not.toBeInTheDocument()
  })

  it('delete button calls removeTodo.mutate with id', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(removeTodoMutate).toHaveBeenCalledWith(1)
  })

  it('add form submission calls createTodo.mutate and clears input', async () => {
    renderSection()
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'New task')
    await userEvent.keyboard('{Enter}')
    expect(createTodoMutate).toHaveBeenCalledWith('New task', expect.any(Object))
  })

  it('past-day: shows helper text and disables input', () => {
    vi.mocked(todayISO).mockReturnValue('2026-06-01')
    renderSection({ isoDate: '2026-05-28' })
    expect(screen.getByText(/cannot add tasks to past days/i)).toBeInTheDocument()
    const input = screen.getByRole('textbox')
    expect(input).toBeDisabled()
  })

  it('past-day: trying to add shows error message', async () => {
    vi.mocked(todayISO).mockReturnValue('2026-06-01')
    renderSection({ isoDate: '2026-05-28' })
    // The form submit fires the addTodo handler which sets actionError for past days
    const form = screen.getByRole('textbox').closest('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true }))
    })
    expect(screen.getByText(/cannot create new tasks on a past journal day/i)).toBeInTheDocument()
  })

  it('manual sort preserves insertion order', () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo, doneTodo] }, isLoading: false } as never)
    renderSection({ sort: 'manual' })
    const items = screen.getAllByRole('listitem').filter(li => li.className.includes('todo'))
    expect(items[0]).toHaveTextContent('Write tests')
    expect(items[1]).toHaveTextContent('Fix bug')
  })

  it('open-first sort puts open todo before done todo', () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [doneTodo, openTodo] }, isLoading: false } as never)
    renderSection({ sort: 'open first' })
    const items = screen.getAllByRole('listitem').filter(li => li.className.includes('todo'))
    expect(items[0]).toHaveTextContent('Write tests')
    expect(items[1]).toHaveTextContent('Fix bug')
  })

  it('done-last sort puts open todo before done todo', () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [doneTodo, openTodo] }, isLoading: false } as never)
    renderSection({ sort: 'done last' })
    const items = screen.getAllByRole('listitem').filter(li => li.className.includes('todo'))
    expect(items[0]).toHaveTextContent('Write tests')
    expect(items[1]).toHaveTextContent('Fix bug')
  })

  it('history button opens dialog with history panel', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /history/i }))
    expect(screen.getByTestId('history-panel')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('modal close button dismisses dialog', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /history/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('pressing Escape dismisses the history modal', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /history/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('double-clicking todo text enters edit mode', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Write tests'))
    const editInput = screen.getByDisplayValue('Write tests')
    expect(editInput).toBeInTheDocument()
  })

  it('pressing Enter in edit input calls editTodo.mutate', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Write tests'))
    const editInput = screen.getByDisplayValue('Write tests')
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Updated task')
    await userEvent.keyboard('{Enter}')
    expect(editTodoMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, title: 'Updated task' })
    )
  })

  it('pressing Escape in edit input returns to read mode without mutate', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Write tests'))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(editTodoMutate).not.toHaveBeenCalled()
  })

  it('focusDraftInput() via ref focuses the add input', () => {
    const ref = createRef<TodosSectionHandle>()
    renderSection(undefined, ref)
    ref.current?.focusDraftInput()
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })

  // ── Subtask (children) tests ────────────────────────────────────────────────

  const childTodo: TaskItemResponseDto = {
    id: 99,
    title: 'Sub A',
    status: 'Todo',
    isComplete: false,
    priority: 'low',
    description: null,
    dueDate: null,
    parentTaskItemId: 1,
    currentJournalDate: '2026-05-28',
  }

  const parentWithChild: TaskItemResponseDto = {
    ...openTodo,
    children: [childTodo],
  }

  it('renders subtask nested under parent when children array is populated', () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parentWithChild] }, isLoading: false } as never)
    renderSection()
    expect(screen.getByText('Sub A')).toBeInTheDocument()
    const li = screen.getByText('Sub A').closest('li')
    expect(li?.className).toContain('todo-child')
  })

  it('subtask with future currentJournalDate gets is-future class', () => {
    const futureChild: TaskItemResponseDto = { ...childTodo, currentJournalDate: '2026-06-10' }
    vi.mocked(useJournalTodos).mockReturnValue({
      data: { data: [{ ...openTodo, children: [futureChild] }] },
      isLoading: false,
    } as never)
    renderSection({ isoDate: '2026-06-02' })
    const li = screen.getByText('Sub A').closest('li')
    expect(li?.className).toContain('is-future')
  })

  it('subtask with past currentJournalDate does NOT get is-future class', () => {
    const pastChild: TaskItemResponseDto = { ...childTodo, currentJournalDate: '2026-05-01' }
    vi.mocked(useJournalTodos).mockReturnValue({
      data: { data: [{ ...openTodo, children: [pastChild] }] },
      isLoading: false,
    } as never)
    renderSection({ isoDate: '2026-06-02' })
    const li = screen.getByText('Sub A').closest('li')
    expect(li?.className).not.toContain('is-future')
  })

  it('future-date badge shows human-readable date', () => {
    const futureChild: TaskItemResponseDto = { ...childTodo, currentJournalDate: '2026-06-10' }
    vi.mocked(useJournalTodos).mockReturnValue({
      data: { data: [{ ...openTodo, children: [futureChild] }] },
      isLoading: false,
    } as never)
    renderSection({ isoDate: '2026-06-02' })
    expect(screen.getByText('Jun 10')).toBeInTheDocument()
  })

  it('toggle on subtask calls mutation with child id', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parentWithChild] }, isLoading: false } as never)
    renderSection()
    const checkButtons = screen.getAllByRole('button', { name: /mark done/i })
    // The child check button follows the parent's — it is the second 'Mark done' button
    await userEvent.click(checkButtons[1])
    expect(toggleTodoMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99 }),
      expect.any(Object)
    )
  })

  it('toggling a subtask does not auto-complete the parent (autoCompleteParentWhenChildrenDone is false)', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parentWithChild] }, isLoading: false } as never)
    renderSection()
    const checkButtons = screen.getAllByRole('button', { name: /mark done/i })
    // Click the child check button (second 'Mark done' button)
    await userEvent.click(checkButtons[1])
    expect(toggleTodoMutate).toHaveBeenCalledWith(
      expect.objectContaining({ autoCompleteParentWhenChildrenDone: false }),
      expect.any(Object)
    )
  })

  it('delete on subtask calls removeTodo.mutate with child id', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parentWithChild] }, isLoading: false } as never)
    renderSection()
    const removeButtons = screen.getAllByRole('button', { name: /remove from day/i })
    await userEvent.click(removeButtons[0])
    expect(removeTodoMutate).toHaveBeenCalledWith(99)
  })

  it('future-scheduled subtask does not show remove button', () => {
    const futureChild: TaskItemResponseDto = { ...childTodo, currentJournalDate: '2026-06-10' }
    vi.mocked(useJournalTodos).mockReturnValue({
      data: { data: [{ ...openTodo, children: [futureChild] }] },
      isLoading: false,
    } as never)
    renderSection({ isoDate: '2026-06-02' })
    // The child row is present but no "Remove from day" button should appear for it
    expect(screen.getByText('Sub A')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove from day/i })).not.toBeInTheDocument()
  })

  it('child task does not appear at top level when nested under parent', () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parentWithChild] }, isLoading: false } as never)
    renderSection()
    const childList = document.querySelector('.todo-child-list')
    expect(childList).toBeInTheDocument()
    // The child li is inside the child list, not a direct sibling of the parent li
    const childLi = screen.getByText('Sub A').closest('li')
    expect(childLi?.closest('.todo-child-list')).toBeInTheDocument()
  })

  it('todo counter reflects top-level count only', () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parentWithChild] }, isLoading: false } as never)
    renderSection()
    // 1 top-level todo, 0 completed → counter shows "0/1"
    expect(screen.getByText('0/1')).toBeInTheDocument()
  })

  // ── Priority and project badges ─────────────────────────────────────────────

  function mockTodos(todos: TaskItemResponseDto[]) {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: todos }, isLoading: false } as never)
  }

  function rowBadges(title: string) {
    return screen.getByText(title).parentElement!.querySelector(':scope > .todo-badges')
  }

  it.each([
    ['Low', 'low'],
    ['Medium', 'medium'],
    ['High', 'high'],
  ])('renders %s priority badge with matching class and text', (priority, expected) => {
    mockTodos([{ ...openTodo, priority }])
    renderSection()
    const badge = screen.getByText(expected)
    expect(badge).toHaveClass('t-badge', `t-badge-${expected}`)
  })

  it('renders project badge with name and title', () => {
    mockTodos([{ ...openTodo, projectName: 'Alpha Project' } as TaskItemResponseDto])
    renderSection()
    const badge = screen.getByText('Alpha Project')
    expect(badge).toHaveClass('t-badge-project')
    expect(badge).toHaveAttribute('title', 'Alpha Project')
  })

  it('long project name is exposed in full as the title', () => {
    const name = 'A very long project name '.repeat(4).trim()
    mockTodos([{ ...openTodo, projectName: name } as TaskItemResponseDto])
    renderSection()
    expect(screen.getByTitle(name)).toBeInTheDocument()
  })

  it.each([null, undefined, ''])('renders no project badge when projectName is %s but keeps priority badge', projectName => {
    mockTodos([{ ...openTodo, priority: 'High', projectName } as TaskItemResponseDto])
    renderSection()
    expect(document.querySelector('.t-badge-project')).toBeNull()
    expect(rowBadges('Write tests')!.children).toHaveLength(1)
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it.each([null, undefined, '', 'Urgent'])('falls back to low badge when priority is %s', priority => {
    mockTodos([{ ...openTodo, priority } as unknown as TaskItemResponseDto])
    renderSection()
    expect(screen.getByText('low')).toHaveClass('t-badge-low')
    expect(document.querySelector('.t-badge-urgent')).toBeNull()
  })

  it('priority badge precedes project badge', () => {
    mockTodos([{ ...openTodo, priority: 'Medium', projectName: 'Alpha' } as TaskItemResponseDto])
    renderSection()
    const group = rowBadges('Write tests')!
    expect(group.children[0]).toHaveTextContent('medium')
    expect(group.children[1]).toHaveTextContent('Alpha')
  })

  it('subtask shows its own priority and project badges', () => {
    const child = { ...childTodo, priority: 'High', projectName: 'Child Proj' } as TaskItemResponseDto
    mockTodos([{ ...openTodo, priority: 'Low', projectName: 'Parent Proj', children: [child] } as TaskItemResponseDto])
    renderSection()
    const childBadges = rowBadges('Sub A')!
    expect(childBadges).toHaveTextContent('high')
    expect(childBadges).toHaveTextContent('Child Proj')
    const parentBadges = rowBadges('Write tests')!
    expect(parentBadges).toHaveTextContent('low')
    expect(parentBadges).toHaveTextContent('Parent Proj')
  })

  it('future-dated subtask shows date badge before the new badges', () => {
    const child = { ...childTodo, currentJournalDate: '2026-06-10', priority: 'High' }
    mockTodos([{ ...openTodo, children: [child] }])
    renderSection({ isoDate: '2026-06-02' })
    const date = screen.getByText('Jun 10')
    const group = rowBadges('Sub A')!
    expect(date.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('badges stay visible in edit mode', async () => {
    mockTodos([{ ...openTodo, priority: 'High', projectName: 'Alpha' } as TaskItemResponseDto])
    renderSection()
    await userEvent.dblClick(screen.getByText('Write tests'))
    expect(screen.getByDisplayValue('Write tests')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('completed row keeps badges outside .todo-text', () => {
    mockTodos([{ ...doneTodo, priority: 'Medium', projectName: 'Alpha' } as TaskItemResponseDto])
    renderSection()
    expect(screen.getByText('medium').closest('.todo-text')).toBeNull()
    expect(screen.getByText('Alpha').closest('.todo-text')).toBeNull()
  })

  it('double-clicking or clicking a badge neither edits nor toggles', async () => {
    mockTodos([{ ...openTodo, priority: 'High', projectName: 'Alpha' } as TaskItemResponseDto])
    renderSection()
    await userEvent.dblClick(screen.getByText('high'))
    await userEvent.click(screen.getByText('Alpha'))
    expect(screen.queryByDisplayValue('Write tests')).not.toBeInTheDocument()
    expect(toggleTodoMutate).not.toHaveBeenCalled()
  })

  it('badges are not focusable or interactive', () => {
    mockTodos([{ ...openTodo, projectName: 'Alpha' } as TaskItemResponseDto])
    renderSection()
    const group = rowBadges('Write tests')!
    expect(group.querySelector('button, [tabindex], [role]')).toBeNull()
  })

  it('toggle, history and delete still work with badges present', async () => {
    mockTodos([{ ...openTodo, priority: 'High', projectName: 'Alpha' } as TaskItemResponseDto])
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(toggleTodoMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), expect.any(Object))
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(screen.getByTestId('history-panel')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(removeTodoMutate).toHaveBeenCalledWith(1)
  })

  it('sort order is unchanged by priority', () => {
    mockTodos([
      { ...openTodo, id: 1, title: 'First', priority: 'Low' },
      { ...openTodo, id: 2, title: 'Second', priority: 'High' },
      { ...doneTodo, id: 3, title: 'Third', priority: 'High' },
    ])
    renderSection({ sort: 'open first' })
    const titles = Array.from(document.querySelectorAll('.todo-text')).map(e => e.textContent)
    expect(titles).toEqual(['First', 'Second', 'Third'])
  })

  it.each(['manual', 'done last'] as const)('sort order is unchanged by priority in %s mode', sort => {
    mockTodos([
      { ...openTodo, id: 1, title: 'First', priority: 'Low' },
      { ...openTodo, id: 2, title: 'Second', priority: 'High' },
      { ...doneTodo, id: 3, title: 'Third', priority: 'High' },
    ])
    renderSection({ sort })
    const titles = Array.from(document.querySelectorAll('.todo-text')).map(e => e.textContent)
    expect(titles).toEqual(['First', 'Second', 'Third'])
  })
})
