import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { TaskItemResponseDto } from '@/api/journal'
import { ToastProvider } from '@/context/ToastContext'

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: {
    all: ['journal'],
    todos: (id: number) => ['journal', id, 'todos'],
    notes: (id: number) => ['journal', id, 'notes'],
  },
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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

import { useJournalTodos } from '@/hooks/useJournal'
import { removeJournalTodo } from '@/api/journal'
import { TodosSection } from './TodosSection'

function todo(overrides: Partial<TaskItemResponseDto>): TaskItemResponseDto {
  return { id: 1, title: 'Write tests', status: 'Todo', priority: 'low', description: null, dueDate: null, ...overrides } as TaskItemResponseDto
}

function load(rows: TaskItemResponseDto[]) {
  vi.mocked(useJournalTodos).mockReturnValue({ data: { data: rows }, isLoading: false } as never)
}

const parent = todo({
  id: 1,
  title: 'Parent task',
  children: [
    todo({ id: 2, title: 'Child one', parentTaskItemId: 1 }),
    todo({ id: 3, title: 'Child two', parentTaskItemId: 1 }),
  ],
})

function Page({ initiallyShown = true }: { initiallyShown?: boolean }) {
  const [shown, setShown] = useState(initiallyShown)
  return (
    <>
      <button onClick={() => setShown(s => !s)}>Toggle section</button>
      {shown && <TodosSection entryId={10} isoDate="2099-01-01" sort="manual" />}
    </>
  )
}

function renderPage() {
  const client = new QueryClient()
  const tree = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </QueryClientProvider>
  )
  return { ...render(tree), tree }
}

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe('TodosSection undoable delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('labels a top-level delete "Remove from day: <title>" with a matching title and keeps the x glyph', () => {
    load([todo({})])
    renderPage()
    const button = screen.getByRole('button', { name: 'Remove from day: Write tests' })
    expect(button).toHaveAttribute('title', 'Remove from day: Write tests')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('truncates a long title to about 30 characters in the toast', () => {
    const long = 'A very long task title that keeps going and going'
    load([todo({ title: long })])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: `Remove from day: ${long}` }))
    const status = within(screen.getByRole('region', { name: 'Notifications' })).getByRole('status')
    expect(status).toHaveTextContent('Removed from this day: "A very long task title that ke…"')
  })

  it('hides the parent and its children together and Undo restores all of them', () => {
    load([parent])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day: Parent task' }))
    expect(screen.queryByText('Parent task')).not.toBeInTheDocument()
    expect(screen.queryByText('Child one')).not.toBeInTheDocument()
    expect(screen.queryByText('Child two')).not.toBeInTheDocument()
    expect(screen.getByText('0/0')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('Parent task')).toBeInTheDocument()
    expect(screen.getByText('Child one')).toBeInTheDocument()
    expect(screen.getByText('Child two')).toBeInTheDocument()
    advance(10000)
    expect(removeJournalTodo).not.toHaveBeenCalled()
  })

  it('commits only the parent id when a parent is removed', () => {
    load([parent])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day: Parent task' }))
    advance(6000)
    expect(removeJournalTodo).toHaveBeenCalledTimes(1)
    expect(removeJournalTodo).toHaveBeenCalledWith(10, 1)
  })

  it('hides a single subtask with its own toast copy and leaves its parent and sibling', () => {
    load([parent])
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from day' })[0])
    expect(screen.queryByText('Child one')).not.toBeInTheDocument()
    expect(screen.getByText('Parent task')).toBeInTheDocument()
    expect(screen.getByText('Child two')).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")).toHaveTextContent("Removed from this day")
  })

  it('keeps the item hidden when the same data is rendered again (a refetch)', () => {
    load([todo({})])
    const { rerender, tree } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day: Write tests' }))
    load([todo({})])
    rerender(tree)
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument()
  })

  it('still commits after the section unmounts, and a remount inside the window stays hidden', () => {
    load([todo({})])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day: Write tests' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle section' }))
    advance(2000)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle section' }))
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle section' }))
    advance(4000)
    expect(removeJournalTodo).toHaveBeenCalledTimes(1)
    expect(removeJournalTodo).toHaveBeenCalledWith(10, 1)
  })

  it('moves focus to the next row delete button, then to the add input when none is left', () => {
    load([todo({ id: 1, title: 'First' }), todo({ id: 2, title: 'Second' })])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day: First' }))
    expect(screen.getByRole('button', { name: 'Remove from day: Second' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day: Second' }))
    expect(screen.getByPlaceholderText('Add a TODO and press Enter')).toHaveFocus()
  })

  it('returns focus to the restored row delete button after Undo via the toast button', () => {
    load([todo({})])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day: Write tests' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    advance(50)
    expect(screen.getByRole('button', { name: 'Remove from day: Write tests' })).toHaveFocus()
  })

  it('does nothing when the row is gone by the time Undo restores focus', () => {
    load([todo({})])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day: Write tests' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle section' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(() => advance(50)).not.toThrow()
  })

  it('shows an error toast and restores the row when the server rejects the delete', async () => {
    vi.mocked(removeJournalTodo).mockRejectedValueOnce({ status: 404 })
    load([parent])
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from day' })[0])
    advance(6000)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't remove from day. Restored.")
    expect(screen.getByText('Child one')).toBeInTheDocument()
  })
})
