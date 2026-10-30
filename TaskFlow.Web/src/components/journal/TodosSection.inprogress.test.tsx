import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import userEvent from '@testing-library/user-event'
import type { TaskItemResponseDto } from '@/api/journal'

const toggleTodoMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: {
    all: ['journal'],
    todos: (id: number) => ['journal', id, 'todos'],
    notes: (id: number) => ['journal', id, 'notes'],
  },
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
  useEditTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemoveTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status === 'Blocked').length),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel" />,
}))

vi.mock('@/lib/journal-utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return { ...actual, todayISO: vi.fn(() => '2026-05-28') }
})

import { useJournalTodos } from '@/hooks/useJournal'
import { TodosSection } from './TodosSection'

function row(overrides: Partial<TaskItemResponseDto>): TaskItemResponseDto {
  return { id: 1, title: 'Write tests', status: 'Todo', priority: 'low', description: null, dueDate: null, ...overrides } as TaskItemResponseDto
}

function load(rows: TaskItemResponseDto[]) {
  vi.mocked(useJournalTodos).mockReturnValue({ data: { data: rows }, isLoading: false } as never)
}

function renderSection() {
  return render(<TodosSection entryId={10} isoDate="2026-05-28" sort="manual" />)
}

describe('TodosSection In Progress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    load([])
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows a compact "In Progress" badge with the start date in its title only', () => {
    load([row({ status: 'InProgress', startedAt: '2026-05-20T15:00:00Z' })])
    renderSection()
    const badge = screen.getByText('In Progress')
    expect(badge).toHaveClass('t-badge-inprogress')
    expect(badge).toHaveAttribute('title', expect.stringContaining('Started May'))
    expect(screen.queryByText(/Started/)).not.toBeInTheDocument()
  })

  it('has no title on the badge when startedAt is null', () => {
    load([row({ status: 'InProgress', startedAt: null })])
    renderSection()
    expect(screen.getByText('In Progress')).not.toHaveAttribute('title')
  })

  it('shows no badge for Todo rows', () => {
    load([row({})])
    renderSection()
    expect(screen.queryByText('In Progress')).not.toBeInTheDocument()
  })

  it('ticking an InProgress row sends done: true', async () => {
    load([row({ status: 'InProgress' })])
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(toggleTodoMutate).toHaveBeenCalledWith({ id: 1, done: true }, expect.any(Object))
  })

  it('offers Block on InProgress rows but not Draft, Completed or Blocked rows', () => {
    load([row({ status: 'InProgress' })])
    const { unmount } = renderSection()
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
    unmount()
    load([row({ id: 2, status: 'Draft' }), row({ id: 3, status: 'Completed' }), row({ id: 4, status: 'Blocked' })])
    renderSection()
    expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument()
  })

  it('counts an InProgress subtask as open in the subtask progress', () => {
    const done = row({ id: 7, title: 'S1', status: 'Completed', parentTaskItemId: 1 })
    const started = row({ id: 8, title: 'S2', status: 'InProgress', parentTaskItemId: 1 })
    load([{ ...row({}), children: [done, started] }])
    renderSection()
    expect(screen.getByText('1/2 done')).toBeInTheDocument()
  })
})
