import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JournalLogEntryResponseDto, JournalNoteResponseDto } from '@/api/journal'
import { useJournalKeyboardShortcuts } from '@/hooks/useJournalKeyboardShortcuts'
import { __resetCoarsePointerCache } from '@/lib/pointer'

const updateNoteMutate = vi.fn()
const updateLogMutate = vi.fn()
const deleteLogMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  useJournalNotes: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateJournalNoteMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateJournalNoteMutation: vi.fn(() => ({ mutate: updateNoteMutate, isPending: false })),
  useDeleteJournalNoteMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useAddLogEntryMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteLogEntryMutation: vi.fn(() => ({ mutate: deleteLogMutate, isPending: false })),
  useUpdateLogEntryMutation: vi.fn(() => ({ mutate: updateLogMutate, isPending: false })),
}))

vi.mock('./TaskTypeahead', () => ({
  TaskTypeahead: () => <input data-testid="task-typeahead" aria-label="Link to task" />,
}))

import { useJournalNotes } from '@/hooks/useJournal'
import { NotesSection } from './NotesSection'
import { DailyLogSection } from './DailyLogSection'

const note: JournalNoteResponseDto = {
  id: 1,
  content: 'Remember to update docs',
  journalEntryId: 10,
  createdAt: '2026-05-28T09:00:00Z',
}

const logEntry: JournalLogEntryResponseDto = {
  id: 1,
  content: 'Fixed the bug',
  journalEntryId: 10,
  createdAt: '2026-05-28T09:00:00Z',
  linkedTaskDeleted: false,
  taskItemId: 7,
  linkedTaskTitle: 'Build the feature',
}

function setTouch(touch: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({ matches: touch }),
    configurable: true,
    writable: true,
  })
  __resetCoarsePointerCache()
}

const onNewLog = vi.fn()
const onNewNote = vi.fn()

function Harness() {
  useJournalKeyboardShortcuts({
    onNewTodo: vi.fn(),
    onNewLog,
    onNewNote,
    onPrevDay: vi.fn(),
    onNextDay: vi.fn(),
    onJumpToToday: vi.fn(),
  })
  return (
    <>
      <DailyLogSection entryId={10} logEntries={[logEntry]} />
      <NotesSection entryId={10} />
    </>
  )
}

const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

describe('journal notes and log acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note], isLoading: false } as never)
    setTouch(true)
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
    document.body.innerHTML = ''
  })

  describe('chord shortcuts with the new controls', () => {
    it('l and n still fire when a note or log text trigger is focused', () => {
      render(<Harness />)
      screen.getByRole('button', { name: 'Remember to update docs' }).focus()
      press('l')
      press('n')
      expect(onNewLog).toHaveBeenCalledTimes(1)
      expect(onNewNote).toHaveBeenCalledTimes(1)

      screen.getByRole('button', { name: 'Fixed the bug' }).focus()
      press('l')
      expect(onNewLog).toHaveBeenCalledTimes(2)
    })

    it('l and n still fire when the note Save button is focused', async () => {
      render(<Harness />)
      await userEvent.click(screen.getByRole('button', { name: 'Remember to update docs' }))
      screen.getByRole('button', { name: 'Save' }).focus()
      press('l')
      press('n')
      expect(onNewLog).toHaveBeenCalledTimes(1)
      expect(onNewNote).toHaveBeenCalledTimes(1)
    })

    it('l and n are typed, not treated as shortcuts, while the log edit input is focused', async () => {
      render(<Harness />)
      await userEvent.click(screen.getByRole('button', { name: 'Fixed the bug' }))
      const edit = screen.getByRole('textbox', { name: 'Edit log entry' })
      await userEvent.type(edit, 'ln')
      expect(edit).toHaveValue('Fixed the bugln')
      expect(onNewLog).not.toHaveBeenCalled()
      expect(onNewNote).not.toHaveBeenCalled()
    })
  })

  describe('log edit then delete', () => {
    it('commits the edit once through blur and then deletes the row', async () => {
      render(<DailyLogSection entryId={10} logEntries={[logEntry]} />)
      await userEvent.click(screen.getByRole('button', { name: 'Fixed the bug' }))
      const edit = screen.getByRole('textbox', { name: 'Edit log entry' })
      await userEvent.type(edit, '!')
      // Tapping delete moves focus off the input first (blur commits), then the click lands.
      await userEvent.click(screen.getByRole('button', { name: /delete entry/i }))
      expect(updateLogMutate).toHaveBeenCalledTimes(1)
      expect(updateLogMutate).toHaveBeenCalledWith({ id: 1, content: 'Fixed the bug!', taskItemId: 7 })
      expect(deleteLogMutate).toHaveBeenCalledTimes(1)
      expect(deleteLogMutate).toHaveBeenCalledWith(1)
    })
  })

  describe('focus return after cancel', () => {
    it('Cancel on an existing note edit returns focus to the note text', async () => {
      render(<NotesSection entryId={10} />)
      await userEvent.click(screen.getByRole('button', { name: 'Remember to update docs' }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remember to update docs' }))
      expect(updateNoteMutate).not.toHaveBeenCalled()
    })

    it('blur to another field leaves focus there and the log edit still commits', async () => {
      render(<DailyLogSection entryId={10} logEntries={[logEntry]} />)
      await userEvent.click(screen.getByRole('button', { name: 'Fixed the bug' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Edit log entry' }), '!')
      const other = screen.getByPlaceholderText(/what did you just work on/i)
      await userEvent.click(other)
      expect(document.activeElement).toBe(other)
      expect(updateLogMutate).toHaveBeenCalledTimes(1)
    })
  })

  it('does not treat a held Enter on the log text as a repeated edit', () => {
    render(<DailyLogSection entryId={10} logEntries={[logEntry]} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Fixed the bug' }), { key: 'Enter', repeat: true })
    expect(screen.queryByRole('textbox', { name: 'Edit log entry' })).not.toBeInTheDocument()
  })
})
