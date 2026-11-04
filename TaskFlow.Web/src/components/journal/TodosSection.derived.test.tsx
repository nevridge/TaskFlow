import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import userEvent from '@testing-library/user-event'
import type { TaskItemResponseDto } from '@/api/journal'

const blockTodoMutate = vi.fn()
const unblockTodoMutate = vi.fn()

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
  useRemoveTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: blockTodoMutate, isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: unblockTodoMutate, isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status === 'Blocked').length),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel" />,
}))

vi.mock('@/lib/journal-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return { ...actual, todayISO: vi.fn(() => '2026-05-28') }
})

import { useJournalTodos } from '@/hooks/useJournal'
import { TodosSection } from './TodosSection'

function row(overrides: Partial<TaskItemResponseDto>): TaskItemResponseDto {
  return { id: 1, title: 'Write tests', status: 'Todo', priority: 'low', description: null, dueDate: null, ...overrides } as TaskItemResponseDto
}

describe('Block and Unblock are withheld from a parent with an open subtask (#385, AC 18)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  const show = (rows: TaskItemResponseDto[]) => {
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: rows }, isLoading: false } as never)
    render(<TodosSection entryId={10} isoDate="2026-05-28" sort="manual" />)
  }

  it('offers no Unblock on a stored-Blocked parent with an open subtask (header form)', () => {
    const child = row({ id: 7, title: 'Sub', parentTaskItemId: 2, status: 'InProgress' })
    const parent = row({
      id: 2,
      title: 'Parent',
      status: 'Blocked',
      blockedReason: 'Waiting on Sam',
      blockedAt: '2026-05-27T10:00:00Z',
      previousStatus: 'Todo',
      openChildCount: 1,
    })
    show([parent, child])
    expect(screen.queryByRole('button', { name: 'Unblock task' })).not.toBeInTheDocument()
    expect(document.querySelector('.t-badge-derived')).toBeNull()
  })

  it('offers no Unblock badge on a stale-linked Blocked parent row that still has an open subtask', () => {
    const parent = row({ id: 2, title: 'Parent', status: 'Blocked', blockedReason: 'Why', previousStatus: 'Todo', openChildCount: 2 })
    show([parent])
    expect(screen.getByText('Parent', { selector: '.todo-text' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unblock task' })).not.toBeInTheDocument()
  })

  it('offers no Block on a stored-Todo parent row with an open subtask (stale link, subtasks off the day)', () => {
    show([row({ id: 1, title: 'Parent', openChildCount: 2 })])
    expect(screen.getByText('Parent', { selector: '.todo-text' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument()
  })

  it('offers no Block on the header cluster of such a parent, but the subtask rows keep theirs', () => {
    const child = row({ id: 7, title: 'Sub', parentTaskItemId: 1 })
    show([row({ id: 1, title: 'Parent', openChildCount: 1 }), child])
    // One Block button: the subtask's. The header carries no buttons at all.
    expect(screen.getAllByRole('button', { name: 'Block' })).toHaveLength(1)
    const header = screen.getByRole('link', { name: /Parent/ }).closest('li') as HTMLElement
    expect(within(header).queryByRole('button')).toBeNull()
  })

  it('keeps Block and Unblock on parents without open subtasks (count 0, missing, or a string 0)', async () => {
    show([
      row({ id: 1, title: 'Zero', openChildCount: 0 }),
      row({ id: 2, title: 'Missing' }),
      row({ id: 3, title: 'Stringy', openChildCount: '0' as unknown as number }),
      row({ id: 4, title: 'Stuck', status: 'Blocked', blockedReason: 'r', previousStatus: 'Todo', openChildCount: 0 }),
    ])
    expect(screen.getAllByRole('button', { name: 'Block' })).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'Unblock task' }))
    expect(unblockTodoMutate).toHaveBeenCalledWith({ id: 4 }, expect.any(Object))
  })

  it('treats a string openChildCount from the generated client as a count', () => {
    show([row({ id: 1, title: 'Parent', openChildCount: '2' as unknown as number })])
    expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument()
  })
})
