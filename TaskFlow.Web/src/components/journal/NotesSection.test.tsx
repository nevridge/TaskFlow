import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import type { NotesSectionHandle } from './NotesSection'
import type { JournalNoteResponseDto } from '@/api/journal'

const createNoteMutate = vi.fn()
const updateNoteMutate = vi.fn()
const deleteNoteMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  useJournalNotes: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateJournalNoteMutation: vi.fn(() => ({ mutate: createNoteMutate, isPending: false })),
  useUpdateJournalNoteMutation: vi.fn(() => ({ mutate: updateNoteMutate, isPending: false })),
  useDeleteJournalNoteMutation: vi.fn(() => ({ mutate: deleteNoteMutate, isPending: false })),
}))

import { useJournalNotes } from '@/hooks/useJournal'
import { NotesSection } from './NotesSection'

const note1: JournalNoteResponseDto = {
  id: 1,
  content: 'Remember to update docs',
  journalEntryId: 10,
  createdAt: '2026-05-28T09:00:00Z',
}

function renderSection(ref?: React.Ref<NotesSectionHandle>) {
  return render(<NotesSection ref={ref} entryId={10} />)
}

describe('NotesSection', () => {
  beforeEach(() => {
    createNoteMutate.mockReset()
    updateNoteMutate.mockReset()
    deleteNoteMutate.mockReset()
    vi.mocked(useJournalNotes).mockReturnValue({ data: [], isLoading: false } as never)
  })

  it('shows empty state when no notes', () => {
    renderSection()
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
  })

  it('renders a note when one exists', () => {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note1], isLoading: false } as never)
    renderSection()
    expect(screen.getByText('Remember to update docs')).toBeInTheDocument()
  })

  it('submitting trimmed text calls createNote.mutate and clears input', async () => {
    renderSection()
    const input = screen.getByRole('textbox')
    await userEvent.type(input, '  New note  ')
    await userEvent.keyboard('{Enter}')
    expect(createNoteMutate).toHaveBeenCalledWith('New note', expect.any(Object))
    expect(input).toHaveValue('')
  })

  it('pressing Escape clears the input', async () => {
    renderSection()
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'some text')
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('clicking delete button calls deleteNote.mutate with note id', async () => {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note1], isLoading: false } as never)
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /delete note/i }))
    expect(deleteNoteMutate).toHaveBeenCalledWith(1)
  })

  it('double-clicking note text shows edit input with note content', async () => {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note1], isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Remember to update docs'))
    const editInput = screen.getByDisplayValue('Remember to update docs')
    expect(editInput).toBeInTheDocument()
  })

  it('pressing Enter in edit input calls updateNote.mutate', async () => {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note1], isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Remember to update docs'))
    const editInput = screen.getByDisplayValue('Remember to update docs')
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Updated note')
    await userEvent.keyboard('{Enter}')
    expect(updateNoteMutate).toHaveBeenCalledWith({ id: 1, content: 'Updated note' })
  })

  it('pressing Escape in edit input returns to read mode without calling mutate', async () => {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note1], isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Remember to update docs'))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByText('Remember to update docs')).toBeInTheDocument()
    expect(updateNoteMutate).not.toHaveBeenCalled()
  })

  it('blurring edit input calls updateNote.mutate when text changed', async () => {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note1], isLoading: false } as never)
    renderSection()
    await userEvent.dblClick(screen.getByText('Remember to update docs'))
    const editInput = screen.getByDisplayValue('Remember to update docs')
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Blurred update')
    await userEvent.tab()
    expect(updateNoteMutate).toHaveBeenCalledWith({ id: 1, content: 'Blurred update' })
  })

  it('focusNewNote() via ref focuses the new note input', () => {
    const ref = createRef<NotesSectionHandle>()
    renderSection(ref)
    ref.current?.focusNewNote()
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })
})
