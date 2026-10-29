import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
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

import { useJournalNotes, useCreateJournalNoteMutation } from '@/hooks/useJournal'
import { NotesSection } from './NotesSection'

const note1: JournalNoteResponseDto = {
  id: 1,
  content: 'Remember to update docs',
  journalEntryId: 10,
  createdAt: '2026-05-28T09:00:00Z',
}

const multiNote: JournalNoteResponseDto = {
  id: 2,
  content: '- a\n- b',
  journalEntryId: 10,
  createdAt: '2026-05-28T10:00:00Z',
}

function renderSection(ref?: React.Ref<NotesSectionHandle>) {
  return render(<NotesSection ref={ref} entryId={10} />)
}

describe('NotesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('add field is a textarea', () => {
    renderSection()
    expect(screen.getByPlaceholderText(/add a note/i).tagName).toBe('TEXTAREA')
  })

  it('Enter creates a trimmed note and clears the field', async () => {
    renderSection()
    const input = screen.getByPlaceholderText(/add a note/i)
    await userEvent.type(input, '  New note  ')
    await userEvent.keyboard('{Enter}')
    expect(createNoteMutate).toHaveBeenCalledTimes(1)
    expect(createNoteMutate).toHaveBeenCalledWith('New note', expect.any(Object))
    expect(input).toHaveValue('')
  })

  it('restores the draft when creating the note fails', async () => {
    // Real mutations fail asynchronously, after the draft has been cleared
    createNoteMutate.mockImplementation((_text, opts) => {
      setTimeout(() => act(() => opts.onError()), 0)
    })
    renderSection()
    const input = screen.getByPlaceholderText(/add a note/i)
    await userEvent.type(input, 'keep me')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(input).toHaveValue('keep me'))
  })

  it('Shift+Enter inserts a newline and does not create a note', async () => {
    renderSection()
    const input = screen.getByPlaceholderText(/add a note/i)
    await userEvent.type(input, 'line one')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await userEvent.keyboard('line two')
    expect(input).toHaveValue('line one\nline two')
    expect(createNoteMutate).not.toHaveBeenCalled()
  })

  it('Enter on whitespace-only text does not create a note', async () => {
    renderSection()
    await userEvent.type(screen.getByPlaceholderText(/add a note/i), '   ')
    await userEvent.keyboard('{Enter}')
    expect(createNoteMutate).not.toHaveBeenCalled()
  })

  it('pressing Escape clears the input', async () => {
    renderSection()
    const input = screen.getByPlaceholderText(/add a note/i)
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

  it('renders stored bullet lines as list items', () => {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [multiNote], isLoading: false } as never)
    renderSection()
    expect(screen.getAllByRole('listitem').filter(li => li.closest('.note-text'))).toHaveLength(2)
  })

  async function startEditing(note = note1) {
    vi.mocked(useJournalNotes).mockReturnValue({ data: [note], isLoading: false } as never)
    renderSection()
    const display = document.querySelector('.note-text') as HTMLElement
    await userEvent.dblClick(display)
    return document.querySelector('.note-edit') as HTMLTextAreaElement
  }

  it('double-clicking shows a textarea with the exact multi-line text', async () => {
    const editInput = await startEditing(multiNote)
    expect(editInput.tagName).toBe('TEXTAREA')
    expect(editInput.value).toBe('- a\n- b')
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
  })

  it('Enter in edit saves once and returns to display', async () => {
    const editInput = await startEditing()
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Updated note')
    await userEvent.keyboard('{Enter}')
    expect(updateNoteMutate).toHaveBeenCalledTimes(1)
    expect(updateNoteMutate).toHaveBeenCalledWith({ id: 1, content: 'Updated note' })
    expect(screen.queryByDisplayValue('Updated note')).not.toBeInTheDocument()
  })

  it('Shift+Enter in edit does not save', async () => {
    const editInput = await startEditing()
    await userEvent.type(editInput, '{Shift>}{Enter}{/Shift}more')
    expect(editInput).toHaveValue('Remember to update docs\nmore')
    expect(updateNoteMutate).not.toHaveBeenCalled()
  })

  it('blur after changing text saves', async () => {
    const editInput = await startEditing()
    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Blurred update')
    await userEvent.tab()
    expect(updateNoteMutate).toHaveBeenCalledWith({ id: 1, content: 'Blurred update' })
  })

  it('Escape after changing text discards the edit', async () => {
    const editInput = await startEditing()
    await userEvent.type(editInput, ' extra')
    await userEvent.keyboard('{Escape}')
    await userEvent.tab()
    expect(updateNoteMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Remember to update docs')).toBeInTheDocument()
  })

  it('Enter then blur calls mutate exactly once', async () => {
    const editInput = await startEditing()
    await userEvent.type(editInput, '!')
    // Blur lands on the still-mounted textarea before React re-renders, as a browser does.
    act(() => {
      fireEvent.keyDown(editInput, { key: 'Enter' })
      fireEvent.blur(editInput)
    })
    expect(updateNoteMutate).toHaveBeenCalledTimes(1)
  })

  it('Escape then blur does not mutate', async () => {
    const editInput = await startEditing()
    await userEvent.type(editInput, '!')
    act(() => {
      fireEvent.keyDown(editInput, { key: 'Escape' })
      fireEvent.blur(editInput)
    })
    expect(updateNoteMutate).not.toHaveBeenCalled()
  })

  it('unchanged text exits without mutate', async () => {
    await startEditing()
    await userEvent.keyboard('{Enter}')
    expect(updateNoteMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Remember to update docs')).toBeInTheDocument()
  })

  it('emptied text exits without mutate', async () => {
    const editInput = await startEditing()
    await userEvent.clear(editInput)
    await userEvent.keyboard('{Enter}')
    expect(updateNoteMutate).not.toHaveBeenCalled()
  })

  describe('desktop', () => {
    it('keeps the key-hint placeholder, the 2000 limit and shows no Save/Cancel buttons', async () => {
      renderSection()
      const input = screen.getByPlaceholderText(/enter to save, shift\+enter for new line/i)
      expect(input).toHaveAttribute('maxlength', '2000')
      await userEvent.type(input, 'draft')
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('a single click does not edit but a double-click does', async () => {
      vi.mocked(useJournalNotes).mockReturnValue({ data: [note1], isLoading: false } as never)
      renderSection()
      const trigger = screen.getByRole('button', { name: 'Remember to update docs' })
      await userEvent.click(trigger)
      expect(screen.queryByRole('textbox', { name: 'Edit note' })).not.toBeInTheDocument()
      await userEvent.dblClick(trigger)
      expect(screen.getByRole('textbox', { name: 'Edit note' })).toBeInTheDocument()
    })

    it.each(['{Enter}', ' '])('keyboard %j on the focused note text starts editing', async key => {
      vi.mocked(useJournalNotes).mockReturnValue({ data: [note1], isLoading: false } as never)
      renderSection()
      screen.getByRole('button', { name: 'Remember to update docs' }).focus()
      await userEvent.keyboard(key)
      expect(screen.getByRole('textbox', { name: 'Edit note' })).toHaveValue('Remember to update docs')
    })

    it('returns focus to the note text after Enter saves the edit', async () => {
      const editInput = await startEditing()
      await userEvent.type(editInput, '!')
      await userEvent.keyboard('{Enter}')
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remember to update docs' }))
    })

    it('does not move focus when blur ends the edit', async () => {
      const editInput = await startEditing()
      await userEvent.type(editInput, '!')
      await userEvent.tab()
      expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Remember to update docs' }))
    })

    it('disables the add textarea while a note is saving', () => {
      vi.mocked(useCreateJournalNoteMutation).mockReturnValueOnce({ mutate: createNoteMutate, isPending: true } as never)
      renderSection()
      expect(screen.getByPlaceholderText(/add a note/i)).toBeDisabled()
    })
  })

  it('focusNewNote() via ref focuses the new note textarea', () => {
    const ref = createRef<NotesSectionHandle>()
    renderSection(ref)
    ref.current?.focusNewNote()
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/add a note/i))
  })
})
