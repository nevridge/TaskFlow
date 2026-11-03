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

describe('TodosSection keeps the stored status for parents with open subtasks (#385, AC 10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows a stored-Blocked parent as Blocked with its reason and an Unblock button despite an In Progress subtask', async () => {
    const child = row({ id: 7, title: 'Sub', parentTaskItemId: 2, status: 'InProgress' })
    const parent = row({
      id: 2,
      title: 'Parent',
      status: 'Blocked',
      blockedReason: 'Waiting on Sam',
      blockedAt: '2026-05-27T10:00:00Z',
      previousStatus: 'Todo',
      children: [child],
    })
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parent] }, isLoading: false } as never)
    render(<TodosSection entryId={10} isoDate="2026-05-28" sort="manual" />)

    const parentLi = screen.getByText('Parent').closest('li') as HTMLElement
    expect(parentLi.className).toContain('is-blocked')
    expect(screen.getByText('Waiting on Sam')).toBeInTheDocument()
    expect(document.querySelector('.t-badge-derived')).toBeNull()

    await userEvent.click(within(parentLi).getByRole('button', { name: 'Unblock task' }))
    expect(unblockTodoMutate).toHaveBeenCalledWith({ id: 2 }, expect.any(Object))
  })

  it('still offers Block on a stored-Todo parent with an open subtask', () => {
    const child = row({ id: 7, title: 'Sub', parentTaskItemId: 1, status: 'InProgress' })
    vi.mocked(useJournalTodos).mockReturnValue({
      data: { data: [row({ id: 1, title: 'Parent', children: [child] })] },
      isLoading: false,
    } as never)
    render(<TodosSection entryId={10} isoDate="2026-05-28" sort="manual" />)

    const parentLi = screen.getByText('Parent').closest('li') as HTMLElement
    expect(within(parentLi).getAllByRole('button', { name: 'Block' }).length).toBeGreaterThan(0)
  })
})
