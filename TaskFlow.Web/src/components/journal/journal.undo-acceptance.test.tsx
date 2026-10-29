import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { JournalLogEntryResponseDto, JournalNoteResponseDto, TaskItemResponseDto } from '@/api/journal'
import { ToastProvider } from '@/context/ToastContext'

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: {
    all: ['journal'],
    todos: (id: number) => ['journal', id, 'todos'],
    notes: (id: number) => ['journal', id, 'notes'],
  },
  useJournalNotes: vi.fn(() => ({ data: [], isLoading: false })),
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateJournalNoteMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateJournalNoteMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useAddLogEntryMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateLogEntryMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useEditTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn(() => 0),
}))

vi.mock('@/api/journal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/journal')>()),
  deleteJournalNote: vi.fn(() => Promise.resolve({})),
  deleteLogEntry: vi.fn(() => Promise.resolve({})),
  removeJournalTodo: vi.fn(() => Promise.resolve({})),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({ TaskHistoryPanel: () => null }))
vi.mock('./TaskTypeahead', () => ({ TaskTypeahead: () => null }))

import { useJournalNotes, useJournalTodos } from '@/hooks/useJournal'
import { deleteJournalNote, deleteLogEntry, removeJournalTodo } from '@/api/journal'
import { NotesSection } from './NotesSection'
import { DailyLogSection } from './DailyLogSection'
import { TodosSection } from './TodosSection'

const note: JournalNoteResponseDto = { id: 1, content: 'A note', journalEntryId: 10, createdAt: '2026-05-28T09:00:00Z' }
const log: JournalLogEntryResponseDto = {
  id: 7, content: 'A log', journalEntryId: 10, createdAt: '2026-05-28T09:00:00Z', linkedTaskDeleted: false,
}

function renderWith(ui: React.ReactElement, client = new QueryClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>,
    ),
  }
}

const notifications = () => screen.getByRole('region', { name: 'Notifications' })
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const settle = () => act(async () => { await Promise.resolve() })

describe('journal undo acceptance (note, log, subtask)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('AC9: a note delete shows the "Note deleted" status toast with an Undo button', () => {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note], isLoading: false } as never)
    renderWith(<NotesSection entryId={10} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    const toast = within(notifications()).getByRole('status')
    expect(toast).toHaveTextContent('Note deleted')
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('AC9: a log delete shows the "Log entry deleted" status toast with an Undo button', () => {
    renderWith(<DailyLogSection entryId={10} logEntries={[log]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    const toast = within(notifications()).getByRole('status')
    expect(toast).toHaveTextContent('Log entry deleted')
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('AC9: a subtask delete toast reads exactly "Removed from this day" with no title', () => {
    const parent = {
      id: 1, title: 'Parent', status: 'Todo', priority: 'low', description: null, dueDate: null,
      children: [{ id: 2, title: 'Child', status: 'Todo', priority: 'low', parentTaskItemId: 1 }],
    } as unknown as TaskItemResponseDto
    vi.mocked(useJournalTodos).mockReturnValue({ data: { data: [parent] }, isLoading: false } as never)
    renderWith(<TodosSection entryId={10} isoDate="2099-01-01" sort="manual" />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day' }))
    const toast = within(notifications()).getByRole('status')
    expect(toast.querySelector('.toast-msg')?.textContent).toBe('Removed from this day')
  })

  it('AC21: Undo via the button returns focus to the restored log row delete button', () => {
    renderWith(<DailyLogSection entryId={10} logEntries={[log]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    advance(50)
    expect(screen.getByRole('button', { name: 'Delete entry' })).toHaveFocus()
    advance(10000)
    expect(deleteLogEntry).not.toHaveBeenCalled()
  })

  it('AC2: a log commit invalidates the journal queries once it settles', async () => {
    const { client } = renderWith(<DailyLogSection entryId={10} logEntries={[log]} />)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    advance(6000)
    await settle()
    expect(deleteLogEntry).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['journal'] })
  })

  it('AC2: a note commit invalidates that entry\'s notes query once it settles', async () => {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note], isLoading: false } as never)
    const { client } = renderWith(<NotesSection entryId={10} />)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    advance(6000)
    await settle()
    expect(deleteJournalNote).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['journal', 10, 'notes'] })
  })

  it('AC2: a todo commit invalidates that entry\'s todos query once it settles', async () => {
    vi.mocked(useJournalTodos).mockReturnValue({
      data: { data: [{ id: 1, title: 'T', status: 'Todo', priority: 'low' }] }, isLoading: false,
    } as never)
    const { client } = renderWith(<TodosSection entryId={10} isoDate="2099-01-01" sort="manual" />)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Remove from day: T' }))
    advance(6000)
    await settle()
    expect(removeJournalTodo).toHaveBeenCalledWith(10, 1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['journal', 10, 'todos'] })
  })

  it('AC24: a failed note delete restores the note and shows the role=alert "Couldn\'t delete. Restored."', async () => {
    vi.mocked(deleteJournalNote).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note], isLoading: false } as never)
    renderWith(<NotesSection entryId={10} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    advance(6000)
    await settle()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't delete. Restored.")
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument()
  })

  it('AC24: a failed log delete restores the entry and shows the role=alert "Couldn\'t delete. Restored."', async () => {
    vi.mocked(deleteLogEntry).mockRejectedValueOnce(new Error('boom'))
    renderWith(<DailyLogSection entryId={10} logEntries={[log]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    advance(6000)
    await settle()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't delete. Restored.")
    expect(screen.getByRole('button', { name: 'Delete entry' })).toBeInTheDocument()
  })
})
