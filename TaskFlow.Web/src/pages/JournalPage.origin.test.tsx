import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/context/ToastContext'
import type { TaskItemResponseDto } from '@/api/journal'

// Real JournalPage + real TodosSection + real router: the details link, shortcuts and weekend redirect together (#404).
vi.mock('@/hooks/useJournal', () => ({
  journalKeys: { all: ['journal'], todos: (id: number) => ['journal', id, 'todos'], notes: (id: number) => ['journal', id, 'notes'] },
  useEnsureJournalEntry: vi.fn(() => ({ entry: { id: 10, logEntries: [] }, isLoading: false, error: null })),
  useJournalTodos: vi.fn(),
  useCreateTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useEditTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  openTodoCount: (todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length,
  blockedTodoCount: () => 0,
}))
vi.mock('@/components/TaskHistoryPanel', () => ({ TaskHistoryPanel: () => null }))
vi.mock('@/components/journal/DateNav', () => ({ DateNav: () => null }))
vi.mock('@/components/journal/JournalHeader', () => ({ JournalHeader: () => null }))
vi.mock('@/components/journal/DailyLogSection', async () => {
  const React = await import('react')
  return {
    DailyLogSection: React.forwardRef((_p: unknown, ref: React.Ref<{ focusDraftInput: () => void }>) => {
      React.useImperativeHandle(ref, () => ({ focusDraftInput: () => {} }))
      return null
    }),
  }
})
vi.mock('@/components/journal/NotesSection', async () => {
  const React = await import('react')
  return {
    NotesSection: React.forwardRef((_p: unknown, ref: React.Ref<{ focusNewNote: () => void }>) => {
      React.useImperativeHandle(ref, () => ({ focusNewNote: () => {} }))
      return null
    }),
  }
})
const outlet = { isDark: false, headerStyle: 'stat' as const, todoSort: 'manual' as const, projectStart: '2026-05-09', weekdaysOnly: false }
vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useOutletContext: () => outlet,
}))

import { useJournalTodos } from '@/hooks/useJournal'
import { JournalPage } from './JournalPage'

const seen: { pathname: string; state: unknown } = { pathname: '', state: null }
const history: string[] = []
function Probe() {
  const l = useLocation()
  useEffect(() => {
    seen.pathname = l.pathname
    seen.state = l.state
    history.push(l.pathname)
  })
  return null
}

const task = (id: number, title = `Task ${id}`) =>
  ({ id, title, status: 'Todo', priority: 'low', description: null, dueDate: null }) as TaskItemResponseDto
const detailsLink = (id: number) => document.querySelector(`[data-todo-details="${id}"]`) as HTMLAnchorElement

function renderAt(entry: string | { pathname: string; state?: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Probe />
          <Routes>
            <Route path="/journal/:date" element={<JournalPage />} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const FRIDAY_PATH = '/journal/11-06-2026'
const SATURDAY_PATH = '/journal/11-07-2026'
const from = '/journal/11-07-2026'

describe('JournalPage with the details link (#404)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    history.length = 0
    outlet.weekdaysOnly = false
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [task(5, 'Write tests')] }, isLoading: false } as never)
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('weekend date with weekdays-only, returning from details', () => {
    beforeEach(() => { outlet.weekdaysOnly = true })

    it('lands on Friday, keeps from and weekendRedirect, drops focusTaskId and focuses the row link', () => {
      renderAt({ pathname: SATURDAY_PATH, state: { from, focusTaskId: 5 } })
      expect(seen.pathname).toBe(FRIDAY_PATH)
      expect(detailsLink(5)).toHaveFocus()
      expect(seen.state).toEqual({ from, weekendRedirect: true })
    })

    it('abandons the focus request when the task is not on Friday, forcing no focus and keeping weekendRedirect', () => {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [task(6, 'Other')] }, isLoading: false } as never)
      renderAt({ pathname: SATURDAY_PATH, state: { from, focusTaskId: 5 } })
      expect(seen.pathname).toBe(FRIDAY_PATH)
      expect(document.body).toHaveFocus()
      expect(seen.state).toEqual({ from, weekendRedirect: true })
    })

    it('keeps the notice visible after focus return clears focusTaskId on Friday', () => {
      renderAt({ pathname: FRIDAY_PATH, state: { from, focusTaskId: 5, weekendRedirect: true } })
      expect(detailsLink(5)).toHaveFocus()
      expect(seen.state).toEqual({ from, weekendRedirect: true })
      expect(screen.getByText(/^Weekdays only .+ redirected to Friday$/)).toBeInTheDocument()
    })

    it('redirects a plain weekend visit with exactly weekendRedirect state', () => {
      renderAt(SATURDAY_PATH)
      expect(seen.pathname).toBe(FRIDAY_PATH)
      expect(seen.state).toEqual({ weekendRedirect: true })
    })

    it('does not bounce between dates while redirecting', () => {
      renderAt({ pathname: SATURDAY_PATH, state: { from, focusTaskId: 5 } })
      expect(new Set(history)).toEqual(new Set([SATURDAY_PATH, FRIDAY_PATH]))
      expect(history[history.length - 1]).toBe(FRIDAY_PATH)
    })
  })

  describe('single-key shortcuts while the details link has focus', () => {
    function focusLink() {
      renderAt({ pathname: '/journal/12-15-2099' })
      const link = detailsLink(5)
      link.focus()
      expect(link).toHaveFocus()
      return link
    }

    it('] moves to the next day without throwing and carries no stale state', () => {
      const link = focusLink()
      fireEvent.keyDown(link, { key: ']' })
      expect(seen.pathname).toBe('/journal/12-16-2099')
      expect(seen.state).toBeNull()
    })

    it('[ moves to the previous day', () => {
      const link = focusLink()
      fireEvent.keyDown(link, { key: '[' })
      expect(seen.pathname).toBe('/journal/12-14-2099')
    })

    it('j moves focus to the next row title and k back, without navigating', () => {
      vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [task(4, 'Before'), task(5, 'Write tests'), task(6, 'After')] }, isLoading: false } as never)
      const link = focusLink()
      fireEvent.keyDown(link, { key: 'j' })
      expect(document.querySelector('[data-todo-title="6"]')).toHaveFocus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'k' })
      fireEvent.keyDown(document.activeElement as Element, { key: 'k' })
      expect(document.querySelector('[data-todo-title="4"]')).toHaveFocus()
      expect(seen.pathname).toBe('/journal/12-15-2099')
    })

    it('t focuses the add input and does not navigate', () => {
      const link = focusLink()
      fireEvent.keyDown(link, { key: 't' })
      expect(seen.pathname).toBe('/journal/12-15-2099')
      expect(document.querySelector('input.add-input')).toHaveFocus()
    })

    it('Enter fires no journal shortcut', () => {
      const link = focusLink()
      fireEvent.keyDown(link, { key: 'Enter' })
      expect(seen.pathname).toBe('/journal/12-15-2099')
    })
  })
})
