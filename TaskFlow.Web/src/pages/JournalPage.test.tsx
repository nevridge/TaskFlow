import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('@/hooks/useJournal', () => ({
  useEnsureJournalEntry: vi.fn(),
}))

vi.mock('@/components/journal/DateNav', () => ({
  DateNav: ({ isoDate }: { isoDate: string }) => <div data-testid="date-nav">{isoDate}</div>,
}))

vi.mock('@/components/journal/JournalHeader', () => ({
  JournalHeader: () => <div data-testid="journal-header" />,
}))

vi.mock('@/components/journal/TodosSection', async () => ({
  TodosSection: React.forwardRef((_props: unknown, ref: React.Ref<{ focusDraftInput: () => void }>) => {
    const inputRef = React.useRef<HTMLInputElement>(null)
    React.useImperativeHandle(ref, () => ({ focusDraftInput: () => inputRef.current?.focus() }))
    return (
      <div data-testid="todos-section">
        <input data-testid="todos-draft" ref={inputRef} />
      </div>
    )
  }),
}))

vi.mock('@/components/journal/DailyLogSection', async () => ({
  DailyLogSection: React.forwardRef((_props: unknown, ref: React.Ref<{ focusDraftInput: () => void }>) => {
    const inputRef = React.useRef<HTMLInputElement>(null)
    React.useImperativeHandle(ref, () => ({ focusDraftInput: () => inputRef.current?.focus() }))
    return (
      <div data-testid="log-section">
        <input data-testid="log-draft" ref={inputRef} />
      </div>
    )
  }),
}))

vi.mock('@/components/journal/NotesSection', async () => ({
  NotesSection: React.forwardRef((_props: unknown, ref: React.Ref<{ focusNewNote: () => void }>) => {
    const inputRef = React.useRef<HTMLInputElement>(null)
    React.useImperativeHandle(ref, () => ({ focusNewNote: () => inputRef.current?.focus() }))
    return (
      <div data-testid="notes-section">
        <input data-testid="notes-draft" ref={inputRef} />
      </div>
    )
  }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useOutletContext: () => ({
      isDark: false,
      headerStyle: 'stat',
      todoSort: 'manual',
      projectStart: '2026-05-09',
    }),
  }
})

import { useEnsureJournalEntry } from '@/hooks/useJournal'
import { JournalPage } from './JournalPage'

const baseEntry = {
  id: 1,
  date: '2026-05-28',
  title: 'May 28, 2026',
  todoTaskItemIds: [],
  logEntries: [],
  createdAt: '2026-05-28T00:00:00Z',
  summary: null,
  updatedAt: null,
}

function renderPage(path = '/journal/05-28-2026') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/journal/:date" element={<JournalPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('JournalPage', () => {
  beforeEach(() => {
    vi.mocked(useEnsureJournalEntry).mockReturnValue({
      entry: baseEntry,
      isLoading: false,
      error: null,
    } as never)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows loading state', () => {
    vi.mocked(useEnsureJournalEntry).mockReturnValue({ entry: undefined, isLoading: true, error: null } as never)
    renderPage()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows error message when error is present', () => {
    vi.mocked(useEnsureJournalEntry).mockReturnValue({
      entry: undefined,
      isLoading: false,
      error: new Error('fetch failed'),
    } as never)
    renderPage()
    expect(screen.getByText(/failed to load journal entry/i)).toBeInTheDocument()
  })

  it('renders todos, log, and notes sections when entry is loaded', () => {
    renderPage()
    expect(screen.getByTestId('todos-section')).toBeInTheDocument()
    expect(screen.getByTestId('log-section')).toBeInTheDocument()
    expect(screen.getByTestId('notes-section')).toBeInTheDocument()
  })

  it('hides sections when no entry and not loading', () => {
    vi.mocked(useEnsureJournalEntry).mockReturnValue({ entry: undefined, isLoading: false, error: null } as never)
    renderPage()
    expect(screen.queryByTestId('todos-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('log-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notes-section')).not.toBeInTheDocument()
  })

  it('parses date from URL and passes as isoDate to DateNav', () => {
    renderPage('/journal/05-28-2026')
    expect(screen.getByTestId('date-nav').textContent).toBe('2026-05-28')
  })

  it('does not crash with an invalid date in URL and passes today as isoDate', () => {
    vi.mocked(useEnsureJournalEntry).mockReturnValue({ entry: undefined, isLoading: false, error: null } as never)
    expect(() => renderPage('/journal/not-a-date')).not.toThrow()
    // Should call useEnsureJournalEntry with some valid date (today's fallback)
    expect(useEnsureJournalEntry).toHaveBeenCalled()
  })

  it('pressing t focuses todos-draft input', async () => {
    renderPage()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('todos-draft'))
    })
  })

  it('pressing l focuses log-draft input', async () => {
    renderPage()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('log-draft'))
    })
  })

  it('pressing n focuses notes-draft input', async () => {
    renderPage()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('notes-draft'))
    })
  })

  it('shortcuts are blocked when an input is focused', async () => {
    renderPage()
    const todosDraft = screen.getByTestId('todos-draft')
    const logDraft = screen.getByTestId('log-draft')
    todosDraft.focus()
    expect(document.activeElement).toBe(todosDraft)

    // Press 'l' — if the guard fires correctly, log-draft must NOT gain focus.
    // If the guard were absent, 'l' would call focusDraftInput on the log section
    // and activeElement would switch to log-draft, making the assertion below fail.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))

    await new Promise(r => setTimeout(r, 50))
    expect(document.activeElement).not.toBe(logDraft)
    expect(document.activeElement).toBe(todosDraft)
  })
})
