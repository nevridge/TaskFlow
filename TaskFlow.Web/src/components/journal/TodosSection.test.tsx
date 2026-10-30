import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, act, fireEvent, within } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import userEvent from '@testing-library/user-event'
import type { TodosSectionHandle } from './TodosSection'
import type { TaskItemResponseDto } from '@/api/journal'

const createTodoMutate = vi.fn()
const toggleTodoMutate = vi.fn()
const editTodoMutate = vi.fn()
const blockTodoMutate = vi.fn()
const unblockTodoMutate = vi.fn()
const editReasonMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: {
    all: ['journal'],
    todos: (id: number) => ['journal', id, 'todos'],
    notes: (id: number) => ['journal', id, 'notes'],
  },
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: createTodoMutate, isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
  useEditTodoMutation: vi.fn(() => ({ mutate: editTodoMutate, isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: blockTodoMutate, isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: unblockTodoMutate, isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: editReasonMutate, isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status === 'Blocked').length),
}))

vi.mock('@/api/journal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/journal')>()),
  removeJournalTodo: vi.fn(() => Promise.resolve({})),
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
import { removeJournalTodo } from '@/api/journal'
import { todayISO } from '@/lib/journal-utils'
import { TodosSection } from './TodosSection'

const openTodo: TaskItemResponseDto = {
  id: 1,
  title: 'Write tests',
  status: 'Todo',
  priority: 'low',
  description: null,
  dueDate: null,
}

const doneTodo: TaskItemResponseDto = {
  id: 2,
  title: 'Fix bug',
  status: 'Completed',
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
    const lowercaseDone: TaskItemResponseDto = { ...openTodo, id: 3, title: 'lowercase', status: 'completed' as never }
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [lowercaseDone] }, isLoading: false } as never)
    renderSection()
    const li = screen.getByText('lowercase').closest('li')
    expect(li?.className).not.toContain('is-done')
  })

  it('toggle button calls toggleTodo.mutate', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /mark done/i }))
    expect(toggleTodoMutate).toHaveBeenCalledWith({ id: 1, done: true }, expect.any(Object))
  })

  it('toggling a completed todo sends done=false with only the id', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [doneTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /mark not done/i }))
    expect(toggleTodoMutate).toHaveBeenCalledWith({ id: 2, done: false }, expect.any(Object))
  })

  it('renaming a completed todo sends only id and title (no status)', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [doneTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Fix bug'))
    const editInput = screen.getByDisplayValue('Fix bug')
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Fix bug properly')
    await userEvent.keyboard('{Enter}')
    expect(editTodoMutate).toHaveBeenCalledTimes(1)
    expect(editTodoMutate).toHaveBeenCalledWith({ id: 2, title: 'Fix bug properly' }, expect.any(Object))
    expect(editTodoMutate.mock.calls[0][0]).not.toHaveProperty('status')
  })

  it('renaming a subtask sends only id and title (no parentTaskItemId)', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [{ ...openTodo, children: [childTodo] }] }, isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Sub A'))
    const editInput = screen.getByDisplayValue('Sub A')
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Sub B')
    await userEvent.keyboard('{Enter}')
    expect(editTodoMutate).toHaveBeenCalledWith({ id: 99, title: 'Sub B' }, expect.any(Object))
    expect(editTodoMutate.mock.calls[0][0]).not.toHaveProperty('parentTaskItemId')
  })

  it('renaming a subtask whose parent is not in the loaded list (shown top-level) sends no parentTaskItemId', async () => {
    // The child is not nested under any loaded todo, so the old code could not look it up and sent parentTaskItemId: null
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [childTodo] }, isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Sub A'))
    const editInput = screen.getByDisplayValue('Sub A')
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Sub C')
    await userEvent.keyboard('{Enter}')
    expect(editTodoMutate).toHaveBeenCalledWith({ id: 99, title: 'Sub C' }, expect.any(Object))
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

  it('delete button hides the row at once and calls removeJournalTodo after the undo window', () => {
    vi.useFakeTimers()
    try {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
      renderSection()
      fireEvent.click(screen.getByRole('button', { name: 'Remove from day: Write tests' }))
      expect(screen.queryByText('Write tests')).not.toBeInTheDocument()
      expect(removeJournalTodo).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(6000) })
      expect(removeJournalTodo).toHaveBeenCalledTimes(1)
      expect(removeJournalTodo).toHaveBeenCalledWith(10, 1)
    } finally {
      vi.useRealTimers()
    }
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
      expect.objectContaining({ id: 1, title: 'Updated task' }),
      expect.any(Object)
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

  describe('task id', () => {
    it('shows ids on top-level and nested subtask rows outside .todo-text', () => {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parentWithChild] }, isLoading: false } as never)
      renderSection()
      const top = screen.getByRole('img', { name: 'Task 1' })
      const sub = screen.getByRole('img', { name: 'Task 99' })
      expect(top).toHaveTextContent('#1')
      expect(sub).toHaveTextContent('#99')
      expect(top.closest('.todo-text')).toBeNull()
      expect(screen.getByText('Write tests')).not.toHaveTextContent('#')
    })

    it('completed row id is outside .todo-text (so title strikethrough does not apply)', () => {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [doneTodo] }, isLoading: false } as never)
      renderSection()
      const id = screen.getByRole('img', { name: 'Task 2' })
      expect(id).toHaveTextContent('#2')
      expect(id.closest('.todo-text')).toBeNull()
    })

    it('keeps the id while editing and the input holds the title only', async () => {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
      renderSection()
      await userEvent.dblClick(screen.getByText('Write tests'))
      expect(screen.getByDisplayValue('Write tests')).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Task 1' })).toBeInTheDocument()
    })

    it('toggle still works and the id is unchanged', async () => {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Mark done' }))
      expect(toggleTodoMutate).toHaveBeenCalled()
      expect(screen.getByRole('img', { name: 'Task 1' })).toBeInTheDocument()
    })

    it('clicking the id does not toggle completion or enter edit mode', async () => {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
      renderSection()

      await userEvent.click(screen.getByRole('img', { name: 'Task 1' }))

      expect(toggleTodoMutate).not.toHaveBeenCalled()
      expect(screen.queryByDisplayValue('Write tests')).toBeNull()
      expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument()
    })

    it('id is not focusable and does not add tab stops to the row', () => {
      const tabStops = (root: HTMLElement) =>
        root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').length

      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [openTodo] }, isLoading: false } as never)
      const withId = renderSection()
      const badge = screen.getByRole('img', { name: 'Task 1' })
      expect(badge).not.toHaveAttribute('tabindex')
      expect(badge.matches('a, button, input, [tabindex]')).toBe(false)
      const countWithId = tabStops(withId.container)
      withId.unmount()

      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [{ ...openTodo, id: undefined }] }, isLoading: false } as never)
      const withoutId = renderSection()
      expect(tabStops(withoutId.container)).toBe(countWithId)
    })

    it('renders no id and no error when id is null', () => {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [{ ...openTodo, id: null }] }, isLoading: false } as never)
      renderSection()
      expect(screen.queryByRole('img')).toBeNull()
      expect(screen.queryByText(/^#/)).toBeNull()
      expect(screen.getByText('Write tests')).toBeInTheDocument()
    })

    it('renders no id when missing', () => {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [{ ...openTodo, id: undefined }] }, isLoading: false } as never)
      renderSection()
      expect(screen.queryByRole('img')).toBeNull()
      expect(screen.queryByText(/^#/)).toBeNull()
    })
  })

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
      { id: 99, done: true, autoCompleteParentWhenChildrenDone: false },
      expect.any(Object)
    )
  })

  it('delete on subtask calls removeJournalTodo with the child id after the undo window', () => {
    vi.useFakeTimers()
    try {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parentWithChild] }, isLoading: false } as never)
      renderSection()
      fireEvent.click(screen.getByRole('button', { name: 'Remove from day' }))
      expect(within(screen.getByRole('region', { name: 'Notifications' })).getByRole('status')).toHaveTextContent('Removed from this day')
      act(() => { vi.advanceTimersByTime(6000) })
      expect(removeJournalTodo).toHaveBeenCalledWith(10, 99)
    } finally {
      vi.useRealTimers()
    }
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
    expect(screen.queryByRole('button', { name: 'Remove from day' })).not.toBeInTheDocument()
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
    return screen.getByText(title).parentElement!.querySelector('.todo-badges')
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
    await userEvent.click(screen.getByRole('button', { name: 'Remove from day: Write tests' }))
    expect(screen.queryByRole('button', { name: 'Remove from day: Write tests' })).not.toBeInTheDocument()
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

  it('manual mode keeps original order regardless of priority', () => {
    // Medium, High, Low differs from both ascending and descending priority order.
    mockTodos([
      { ...openTodo, id: 1, title: 'First', priority: 'Medium' },
      { ...openTodo, id: 2, title: 'Second', priority: 'High' },
      { ...openTodo, id: 3, title: 'Third', priority: 'Low' },
    ])
    renderSection({ sort: 'manual' })
    const titles = Array.from(document.querySelectorAll('.todo-text')).map(e => e.textContent)
    expect(titles).toEqual(['First', 'Second', 'Third'])
  })

  it('done last mode only moves done items, ignoring priority', () => {
    // A priority sort would put the done High item first (desc) or last-but-reordered (asc: Low, Medium, High).
    mockTodos([
      { ...doneTodo, id: 1, title: 'Done high', priority: 'High' },
      { ...openTodo, id: 2, title: 'Open medium', priority: 'Medium' },
      { ...openTodo, id: 3, title: 'Open low', priority: 'Low' },
    ])
    renderSection({ sort: 'done last' })
    const titles = Array.from(document.querySelectorAll('.todo-text')).map(e => e.textContent)
    expect(titles).toEqual(['Open medium', 'Open low', 'Done high'])
  })
})
