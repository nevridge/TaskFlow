import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import userEvent from '@testing-library/user-event'
import type { TaskItemResponseDto } from '@/api/journal'
import { JOURNAL_COMPLETED_COLLAPSED_KEY } from '@/hooks/useCompletedCollapsed'

vi.mock('@/hooks/useJournal', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useJournal')>()
  return {
    ...actual,
    useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
    useCreateTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useToggleTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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

const base = { id: 1, title: 'Open task', status: 'Todo', priority: 'low' } as TaskItemResponseDto
const open = (id: number, title: string): TaskItemResponseDto => ({ ...base, id, title })
const done = (id: number, title: string, day = TODAY): TaskItemResponseDto =>
  ({ ...base, id, title, status: 'Completed', completedAt: `${day}T12:00:00Z`, currentJournalDate: day }) as TaskItemResponseDto

function show(list: TaskItemResponseDto[], isoDate = TODAY, sort: 'manual' | 'open first' | 'done last' = 'manual') {
  vi.mocked(useJournalTodos).mockReturnValue({ data: { data: list }, isLoading: false } as never)
  return render(<TodosSection entryId={10} isoDate={isoDate} sort={sort} />)
}

const toggle = () => screen.queryByRole('button', { name: /^Completed/ })

describe('TodosSection Completed group', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('hides completed rows by default and shows a collapsed toggle with their count', () => {
    show([done(2, 'Finished A'), open(3, 'Working'), done(4, 'Finished B')])
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.queryByText('Finished A')).not.toBeInTheDocument()
    expect(screen.queryByText('Finished B')).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveTextContent('2')
  })

  it('keeps the header counter counting every row, hidden or not', () => {
    show([done(2, 'Finished A'), open(3, 'Working')])
    expect(screen.getByText('1/2', { selector: '.todo-count' })).toBeInTheDocument()
  })

  it('expands to show completed rows after the open ones, and remembers the choice', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const { unmount } = show([done(2, 'Finished A'), open(3, 'Working')])
    await user.click(toggle()!)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    const titles = screen.getAllByRole('listitem').map(li => li.textContent ?? '')
    expect(titles.findIndex(t => t.includes('Working'))).toBeLessThan(titles.findIndex(t => t.includes('Finished A')))
    expect(localStorage.getItem(JOURNAL_COMPLETED_COLLAPSED_KEY)).toBe('false')

    unmount()
    show([done(2, 'Finished A'), open(3, 'Working')])
    expect(screen.getByText('Finished A')).toBeInTheDocument()
  })

  it('does not write storage until the user toggles', () => {
    show([done(2, 'Finished A')])
    expect(localStorage.getItem(JOURNAL_COMPLETED_COLLAPSED_KEY)).toBeNull()
  })

  it('shows every row and no toggle on a past day', () => {
    show([done(2, 'Old win', PAST), open(3, 'Missed')], PAST)
    expect(screen.getByText('Old win')).toBeInTheDocument()
    expect(screen.getByText('Missed')).toBeInTheDocument()
    expect(toggle()).not.toBeInTheDocument()
  })

  it('has no toggle when nothing is completed', () => {
    show([open(2, 'Working')])
    expect(toggle()).not.toBeInTheDocument()
  })

  it('says nothing is left when every row is completed', () => {
    show([done(2, 'Finished A')])
    expect(screen.getByText('Nothing left to do.')).toBeInTheDocument()
    expect(toggle()).toBeInTheDocument()
  })

  it('applies on top of the sort: manual order is kept among open rows', () => {
    show([open(2, 'Second'), done(3, 'Finished'), open(4, 'First')], TODAY, 'manual')
    const titles = screen.getAllByRole('listitem').map(li => li.textContent ?? '')
    expect(titles[0]).toContain('Second')
    expect(titles[1]).toContain('First')
  })

  describe('subtasks', () => {
    const parent = { ...open(10, 'Parent'), openChildCount: 1 } as TaskItemResponseDto
    const subDone = { ...done(11, 'Sub done'), parentTaskItemId: 10 } as TaskItemResponseDto
    const subOpen = { ...open(12, 'Sub open'), parentTaskItemId: 10 } as TaskItemResponseDto
    const headers = () => screen.queryAllByRole('link', { name: /^Parent task/ })

    it('moves a completed subtask to Completed while its open sibling stays, and the toggle counts it', () => {
      show([parent, subDone, subOpen])
      expect(screen.getByText('Sub open')).toBeInTheDocument()
      expect(screen.queryByText('Sub done')).not.toBeInTheDocument()
      expect(toggle()).toHaveTextContent('1')
      expect(headers()).toHaveLength(1)
    })

    it('shows the parent header above the completed subtask once expanded, with whole-group progress on both', async () => {
      const user = userEvent.setup({ advanceTimers: () => {} })
      show([parent, subDone, subOpen])
      await user.click(toggle()!)
      expect(screen.getByText('Sub done')).toBeInTheDocument()
      expect(headers()).toHaveLength(2)
      headers().forEach(h => expect(h.closest('li')).toHaveTextContent('1/2 subtasks complete'))
      const items = screen.getAllByRole('listitem')
      const doneRow = items.findIndex(li => li.textContent?.includes('Sub done'))
      expect(items[doneRow - 1]).toHaveTextContent('Parent')
      expect(items[doneRow - 1].className).toContain('todo-context-header')
    })

    it('gives each header copy a distinct description target for its subtask rows', async () => {
      const user = userEvent.setup({ advanceTimers: () => {} })
      show([parent, subDone, subOpen])
      await user.click(toggle()!)
      const ids = Array.from(document.querySelectorAll('[id^="todo-ctx-"]')).map(e => e.id)
      expect(new Set(ids).size).toBe(ids.length)
      const described = Array.from(document.querySelectorAll('[aria-describedby^="todo-ctx-"]'))
      described.forEach(el => expect(document.getElementById(el.getAttribute('aria-describedby')!)).not.toBeNull())
    })

    it('moves a whole group to Completed when all its subtasks are done', () => {
      const p = { ...open(10, 'Parent') } as TaskItemResponseDto
      show([p, { ...done(11, 'Sub A'), parentTaskItemId: 10 } as TaskItemResponseDto, { ...done(12, 'Sub B'), parentTaskItemId: 10 } as TaskItemResponseDto])
      expect(screen.queryByText('Sub A')).not.toBeInTheDocument()
      expect(toggle()).toHaveTextContent('2')
    })
  })
})
