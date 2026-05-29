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
    createTodoMutate.mockReset()
    toggleTodoMutate.mockReset()
    editTodoMutate.mockReset()
    removeTodoMutate.mockReset()
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
})
