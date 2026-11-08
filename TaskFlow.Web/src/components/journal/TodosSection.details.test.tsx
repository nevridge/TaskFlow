import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { TaskItemResponseDto } from '@/api/journal'
import { makeProviders } from '@/test/renderWithToast'

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: { all: ['journal'], todos: (id: number) => ['journal', id, 'todos'], notes: (id: number) => ['journal', id, 'notes'] },
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
vi.mock('@/lib/journal-utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return { ...actual, todayISO: vi.fn(() => '2026-11-07') }
})

import { useJournalTodos } from '@/hooks/useJournal'
import { TodosSection } from './TodosSection'

const DAY = '2026-11-07'

function row(overrides: Partial<TaskItemResponseDto>): TaskItemResponseDto {
  return { id: 1, title: 'Task', status: 'Todo', priority: 'low', description: null, dueDate: null, ...overrides } as TaskItemResponseDto
}
const sub = (id: number) => row({ id, title: `Sub ${id}`, parentTaskItemId: 1, parentTitle: 'Parent' })

function load(rows: TaskItemResponseDto[], isLoading = false) {
  vi.mocked(useJournalTodos).mockReturnValue({ data: isLoading ? undefined : { data: rows }, isLoading } as never)
}

const probe: { seen: { pathname: string; state: unknown; key: string }; go: ReturnType<typeof useNavigate> } = {
  seen: { pathname: '', state: null, key: '' },
  go: (() => {}) as ReturnType<typeof useNavigate>,
}
function Probe() {
  const l = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    probe.seen = { pathname: l.pathname, state: l.state, key: l.key }
    probe.go = navigate
  })
  return null
}

type Entry = string | { pathname: string; state?: unknown }
function renderAt(entry: Entry = '/journal/11-07-2026') {
  const Providers = makeProviders()
  const ui = () => (
    <Providers>
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
        <Routes>
          <Route path="/journal/:date" element={<TodosSection entryId={10} isoDate={DAY} sort="manual" />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </Providers>
  )
  const result = rtlRender(ui())
  return { ...result, rerenderSame: () => result.rerender(ui()) }
}

const detailsLink = (id: number) => document.querySelector(`[data-todo-details="${id}"]`) as HTMLAnchorElement

describe('TodosSection details link (#404)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    load([row({ id: 5, title: 'Write tests' })])
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('links each row to its task, named by title, carrying the journal day and the row id', async () => {
    renderAt()
    const link = screen.getByRole('link', { name: 'Open details: Write tests' })
    expect(link).toHaveAttribute('href', '/tasks/5')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(link).not.toHaveTextContent(/\S/)
    await userEvent.click(link)
    expect(probe.seen.pathname).toBe('/tasks/5')
    expect(probe.seen.state).toEqual({ from: '/journal/11-07-2026', focusTaskId: 5 })
  })

  it('builds from from the isoDate prop, not the current path', async () => {
    renderAt('/journal/garbage')
    await userEvent.click(detailsLink(5))
    expect((probe.seen.state as { from: string }).from).toBe('/journal/11-07-2026')
  })

  it('comes after the title and the row actions in tab order, and Enter navigates', async () => {
    renderAt()
    const user = userEvent.setup()
    const stops: string[] = []
    for (let i = 0; i < 6; i++) {
      await user.tab()
      const el = document.activeElement as HTMLElement
      stops.push(
        el.getAttribute('data-todo-check') ? 'check'
          : el.getAttribute('data-todo-title') ? 'title'
            : el.getAttribute('data-todo-details') ? 'details'
              : (el.getAttribute('aria-label') ?? el.tagName),
      )
    }
    expect(stops.slice(0, 2)).toEqual(['check', 'title'])
    const at = stops.indexOf('details')
    expect(at).toBeGreaterThan(2)
    expect(stops[at - 1]).toMatch(/Remove from day/)
    detailsLink(5).focus()
    await user.keyboard('{Enter}')
    expect(probe.seen.pathname).toBe('/tasks/5')
  })

  it('gives subtask rows under a header the same sibling link', () => {
    load([row({ id: 1, title: 'Parent', openChildCount: 1, childTaskCount: 1 }), sub(2)])
    renderAt()
    expect(detailsLink(2)).toBeInTheDocument()
    expect(detailsLink(2).closest('button')).toBeNull()
    expect(detailsLink(2).closest('li')).toHaveClass('todo-child')
  })

  it('carries only from on the context header Parent task link', async () => {
    load([row({ id: 1, title: 'Parent', openChildCount: 1, childTaskCount: 1 }), sub(2)])
    renderAt()
    await userEvent.click(screen.getByRole('link', { name: /^Parent task/ }))
    expect(probe.seen.pathname).toBe('/tasks/1')
    expect(probe.seen.state).toEqual({ from: '/journal/11-07-2026' })
  })

  it('does not navigate when the title is double-clicked (inline edit still opens)', async () => {
    renderAt()
    const before = probe.seen.key
    await userEvent.dblClick(screen.getByRole('button', { name: 'Write tests' }))
    expect(probe.seen.key).toBe(before)
    expect(document.querySelector('input.todo-edit')).not.toBeNull()
  })

  describe('focus return', () => {
    const from = '/journal/11-07-2026'

    it('focuses the row link when rows render late (past the 100ms window) and clears only the focus key', async () => {
      vi.useFakeTimers()
      load([], true)
      const { rerenderSame } = renderAt({ pathname: '/journal/11-07-2026', state: { from, focusTaskId: 5, weekendRedirect: true } })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      load([row({ id: 5, title: 'Write tests' })])
      rerenderSame()
      expect(detailsLink(5)).toHaveFocus()
      expect(probe.seen.state).toEqual({ from, weekendRedirect: true })
    })

    it('survives a keypress before the rows load', () => {
      load([], true)
      const { rerenderSame, container } = renderAt({ pathname: '/journal/11-07-2026', state: { focusTaskId: 5 } })
      fireEvent.keyDown(container.querySelector('section') as HTMLElement, { key: 'a' })
      load([row({ id: 5, title: 'Write tests' })])
      rerenderSame()
      expect(detailsLink(5)).toHaveFocus()
      expect(probe.seen.state).toBeNull()
    })

    it('does not refocus when the section is mounted again after the state was cleared', () => {
      const { unmount } = renderAt({ pathname: '/journal/11-07-2026', state: { focusTaskId: 5 } })
      expect(detailsLink(5)).toHaveFocus()
      expect(probe.seen.state).toBeNull()
      unmount()
      renderAt('/journal/11-07-2026')
      expect(detailsLink(5)).not.toHaveFocus()
    })

    it('forces no focus and still clears the key when the row is gone', () => {
      load([row({ id: 6, title: 'Other' })])
      renderAt({ pathname: '/journal/11-07-2026', state: { focusTaskId: 5, weekendRedirect: true } })
      expect(document.body).toHaveFocus()
      expect(probe.seen.state).toEqual({ weekendRedirect: true })
    })

    it('adds no state and navigates nowhere when there is no focus request', () => {
      renderAt({ pathname: '/journal/11-07-2026', state: { weekendRedirect: true } })
      const key = probe.seen.key
      expect(probe.seen.state).toEqual({ weekendRedirect: true })
      expect(probe.seen.key).toBe(key)
      expect(document.body).toHaveFocus()
    })

    it('reads a focus id that arrives by in-place navigation after mount (weekend redirect)', () => {
      renderAt('/journal/11-07-2026')
      expect(document.body).toHaveFocus()
      act(() => probe.go('/journal/11-06-2026', { replace: true, state: { focusTaskId: 5, weekendRedirect: true } }))
      expect(detailsLink(5)).toHaveFocus()
      expect(probe.seen.state).toEqual({ weekendRedirect: true })
    })
  })
})
