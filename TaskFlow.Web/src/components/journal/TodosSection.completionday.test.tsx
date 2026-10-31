import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import userEvent from '@testing-library/user-event'
import type { TaskItemResponseDto } from '@/api/journal'

const toggleTodoMutate = vi.fn()

vi.mock('@/hooks/useJournal', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useJournal')>()
  return {
    ...actual,
    useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
    useCreateTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
    useEditTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useBlockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useUnblockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  }
})

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel" />,
}))

import { useJournalTodos } from '@/hooks/useJournal'
import { TodosSection } from './TodosSection'

// "Now" is Fri 2026-06-05 15:00Z; completion times use 12:00Z so the day is stable in any timezone.
const NOW = new Date('2026-06-05T15:00:00Z')
const TODAY = '2026-06-05'
const PAST = '2026-06-02'
const HINT = 'Completed tasks on past days cannot be reopened'

const base: TaskItemResponseDto = { id: 1, title: 'Open task', status: 'Todo', priority: 'low' } as TaskItemResponseDto
const doneOn = (id: number, title: string, day: string, extra: Partial<TaskItemResponseDto> = {}): TaskItemResponseDto =>
  ({ ...base, id, title, status: 'Completed', completedAt: `${day}T12:00:00Z`, currentJournalDate: day, ...extra }) as TaskItemResponseDto

function show(list: TaskItemResponseDto[], isoDate = PAST, sort: 'manual' | 'open first' | 'done last' = 'manual') {
  vi.mocked(useJournalTodos).mockReturnValue({ data: { data: list }, isLoading: false } as never)
  return render(<TodosSection entryId={10} isoDate={isoDate} sort={sort} />)
}

describe('TodosSection completion-day behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('disables the checkbox of a completed task whose completion day is past, with an accessible explanation', async () => {
    show([doneOn(2, 'Old win', PAST)])
    const box = screen.getByRole('checkbox', { checked: true })
    expect(box).toBeDisabled()
    expect(box).toHaveAccessibleDescription(HINT)
    await userEvent.setup({ advanceTimers: () => {} }).click(box)
    expect(toggleTodoMutate).not.toHaveBeenCalled()
  })

  it('takes the blocked checkbox out of the tab order', async () => {
    show([doneOn(2, 'Old win', PAST), { ...base, id: 3, title: 'Next' }])
    const user = userEvent.setup({ advanceTimers: () => {} })
    await user.tab()
    expect(screen.getByRole('checkbox')).not.toHaveFocus()
  })

  it('blocks on the linked day when completedAt is null', () => {
    show([doneOn(2, 'Legacy', PAST, { completedAt: null })])
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })

  it.each([
    ['completed today', doneOn(2, 'Fresh', TODAY), TODAY],
    ['open on a past day', { ...base, id: 3, currentJournalDate: PAST } as TaskItemResponseDto, PAST],
    ['completed with no day', { ...base, id: 4, status: 'Completed', completedAt: null, currentJournalDate: null } as TaskItemResponseDto, PAST],
  ])('keeps the check enabled for %s', async (_name, task, day) => {
    show([task], day)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    const check = screen.getByRole('button', { name: /^Mark/ })
    expect(check).toBeEnabled()
    await userEvent.setup({ advanceTimers: () => {} }).click(check)
    expect(toggleTodoMutate).toHaveBeenCalledTimes(1)
  })

  it('shows one helper line for any number of blocked rows, merged with the past-day helper', () => {
    show([doneOn(2, 'A', PAST), doneOn(3, 'B', PAST)])
    const helpers = document.querySelectorAll('.todo-helper')
    expect(helpers).toHaveLength(1)
    expect(helpers[0].textContent).toBe(
      "Cannot add tasks to past days. Completed tasks remain as history for this date. Completed tasks on past days can't be reopened.",
    )
  })

  it('shows no helper when nothing is blocked and the day is today', () => {
    show([{ ...base }], TODAY)
    expect(document.querySelector('.todo-helper')).toBeNull()
  })

  it.each([PAST, TODAY, '2026-06-09'])('hides Remove from day on a completed row with completedAt (viewed %s)', day => {
    show([doneOn(2, 'Done', day), { ...base, id: 3, title: 'Still open' }], day)
    expect(screen.queryByRole('button', { name: /Remove from day: Done/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove from day: Still open/ })).toBeInTheDocument()
  })

  it('keeps Remove from day for a completed row without completedAt', () => {
    show([{ ...base, status: 'Completed', completedAt: null, currentJournalDate: null } as TaskItemResponseDto], TODAY)
    expect(screen.getByRole('button', { name: /Remove from day/ })).toBeInTheDocument()
  })

  it('labels "Completed here" only when the completion day is the viewed day', () => {
    show([doneOn(2, 'Here', TODAY), doneOn(3, 'Linked', TODAY, { currentJournalDate: '2026-06-01' }), { ...base, id: 4, status: 'Completed', completedAt: null } as TaskItemResponseDto], TODAY)
    expect(screen.getAllByText('Completed here')).toHaveLength(2)
    expect(screen.getByText('Linked').closest('li')).toHaveTextContent('Jun 1')
    expect(screen.getByText('Here').closest('li')).not.toHaveTextContent('Jun 1')
    const legacy = screen.getByText('Open task').closest('li') as HTMLElement
    expect(within(legacy).queryByText('Completed here')).not.toBeInTheDocument()
  })

  it('does not label rows completed on another day', () => {
    show([doneOn(2, 'Elsewhere', '2026-06-01')], PAST)
    expect(screen.queryByText('Completed here')).not.toBeInTheDocument()
  })

  it('sorts completion-day rows into the completed tier', () => {
    show([doneOn(2, 'Finished', TODAY), { ...base, id: 3, title: 'Waiting' }], TODAY, 'open first')
    const titles = screen.getAllByRole('listitem').map(li => li.textContent ?? '')
    expect(titles[0]).toContain('Waiting')
    expect(titles[1]).toContain('Finished')
  })

  it('places context-only parents after the real rows in non-tier sort modes', () => {
    const parent = { ...base, id: 9, title: 'Parent', isContextOnly: true, children: [{ ...base, id: 10, title: 'Child', parentTaskItemId: 9, currentJournalDate: TODAY }] } as TaskItemResponseDto
    show([parent, { ...base, id: 11, title: 'Solo' }], TODAY, 'manual')
    const items = screen.getAllByRole('listitem').filter(li => li.classList.contains('todo') && !li.classList.contains('todo-child'))
    expect(items[0]).toHaveTextContent('Solo')
    expect(items[1]).toHaveTextContent('Parent')
  })

  it('counts roots only and leaves context-only parents out', () => {
    const parent = { ...base, id: 9, title: 'Parent', isContextOnly: true, children: [{ ...base, id: 10, title: 'Child', parentTaskItemId: 9, currentJournalDate: TODAY }] } as TaskItemResponseDto
    show([parent, { ...base, id: 11, title: 'Solo' }], TODAY)
    expect(screen.getByText('0/1')).toBeInTheDocument()
  })

  it('renders a context-only parent inertly above its attributed child', async () => {
    const attributed = { ...base, id: 10, title: 'Child', parentTaskItemId: 9, currentJournalDate: TODAY } as TaskItemResponseDto
    const elsewhere = { ...base, id: 12, title: 'Other-day child', parentTaskItemId: 9, status: 'Completed', completedAt: '2026-06-01T12:00:00Z', currentJournalDate: '2026-06-01' } as TaskItemResponseDto
    const parent = { ...base, id: 9, title: 'Parent', isContextOnly: true, children: [attributed, elsewhere] } as TaskItemResponseDto
    show([parent], TODAY)
    const li = screen.getByText('Parent').closest('li.todo-context-parent') as HTMLElement
    expect(within(li).getByText('Parent task')).toBeInTheDocument()
    expect(within(li).getByRole('button', { name: 'History' })).toBeInTheDocument()
    // Only the parent's own row has no controls; the child inside the nested list stays actionable.
    expect(li.querySelectorAll(':scope > [data-todo-check], :scope > .todo-subline .todo-x, :scope > .todo-subline .todo-block')).toHaveLength(0)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(screen.queryByText('Other-day child')).not.toBeInTheDocument()
    await userEvent.setup({ advanceTimers: () => {} }).dblClick(screen.getByText('Parent'))
    expect(screen.queryByDisplayValue('Parent')).not.toBeInTheDocument()
  })

  it('moves focus to the next row check when a past-day row is completed, and announces the move', async () => {
    show([{ ...base, id: 1, title: 'First' }, { ...base, id: 2, title: 'Second' }], PAST)
    const user = userEvent.setup({ advanceTimers: () => {} })
    const checks = screen.getAllByRole('button', { name: 'Mark done' })
    checks[0].focus()
    await user.keyboard('{Enter}')
    expect(toggleTodoMutate).toHaveBeenCalledTimes(1)
    expect(checks[1]).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Completed. Moved to today.')
  })

  it('does not announce a move when completing on today', async () => {
    show([{ ...base }], TODAY)
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole('button', { name: 'Mark done' }))
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('shows a role=alert and clears the move announcement when completing from a past day fails', async () => {
    toggleTodoMutate.mockImplementation((_vars, opts) => opts.onError(new Error('boom')))
    show([{ ...base, id: 1, title: 'First' }], PAST)
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole('button', { name: 'Mark done' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to save task changes. Please try again.')
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('shows the inline error when the server rejects a reopen (stale view)', async () => {
    toggleTodoMutate.mockImplementation((_vars, opts) =>
      opts.onError({ response: { status: 422 }, error: { code: 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED' } }),
    )
    show([{ ...base, status: 'Completed', completedAt: null, currentJournalDate: TODAY } as TaskItemResponseDto], TODAY)
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole('button', { name: 'Mark not done' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
