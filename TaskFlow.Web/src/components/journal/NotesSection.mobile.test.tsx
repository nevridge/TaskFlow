import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JournalNoteResponseDto } from '@/api/journal'
import { __resetCoarsePointerCache } from '@/lib/pointer'

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

function setTouch(touch: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({ matches: touch }),
    configurable: true,
    writable: true,
  })
  __resetCoarsePointerCache()
}

function loadNotes(notes: JournalNoteResponseDto[]) {
  vi.mocked(useJournalNotes).mockReturnValue({ data: notes, isLoading: false } as never)
}

const renderSection = () => render(<NotesSection entryId={10} />)
const addBox = () => screen.getByPlaceholderText(/add a note/i) as HTMLTextAreaElement
const noteTrigger = (name = 'Remember to update docs') => screen.getByRole('button', { name })

describe('NotesSection on touch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoarsePointerCache()
    loadNotes([])
    vi.mocked(useCreateJournalNoteMutation).mockReturnValue({ mutate: createNoteMutate, isPending: false } as never)
    setTouch(true)
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
    document.body.innerHTML = ''
  })

  describe('add textarea', () => {
    it('has the short placeholder, a 2000 limit and an enter key hint', () => {
      renderSection()
      expect(addBox()).toHaveAttribute('placeholder', 'Add a note')
      expect(addBox()).toHaveAttribute('maxlength', '2000')
      expect(addBox()).toHaveAttribute('enterkeyhint', 'enter')
    })

    it('hides Save and Cancel until the textarea is focused or has a draft', async () => {
      renderSection()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      await userEvent.click(addBox())
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })

    it('puts Cancel before Save in DOM order, both real buttons', async () => {
      renderSection()
      await userEvent.click(addBox())
      const names = screen.getAllByRole('button').map(b => b.textContent)
      expect(names.indexOf('Cancel')).toBeLessThan(names.indexOf('Save'))
      expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button')
    })

    it('Enter inserts a newline and saves nothing', async () => {
      renderSection()
      await userEvent.type(addBox(), 'line one{Enter}line two')
      expect(addBox()).toHaveValue('line one\nline two')
      expect(createNoteMutate).not.toHaveBeenCalled()
    })

    it('Ctrl+Enter saves', async () => {
      renderSection()
      await userEvent.type(addBox(), 'from keyboard')
      await userEvent.keyboard('{Control>}{Enter}{/Control}')
      expect(createNoteMutate).toHaveBeenCalledWith('from keyboard', expect.any(Object))
    })

    it('disables Save for empty and whitespace-only text', async () => {
      renderSection()
      await userEvent.click(addBox())
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      await userEvent.type(addBox(), '   ')
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      await userEvent.type(addBox(), 'x')
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('Save saves the trimmed note and keeps focus in the textarea', async () => {
      renderSection()
      await userEvent.type(addBox(), '  my note ')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(createNoteMutate).toHaveBeenCalledTimes(1)
      expect(createNoteMutate).toHaveBeenCalledWith('my note', expect.any(Object))
      expect(addBox()).toHaveValue('')
      expect(document.activeElement).toBe(addBox())
    })

    it('Cancel clears the draft, blurs the textarea and hides the row', async () => {
      renderSection()
      await userEvent.type(addBox(), 'throw away')
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(addBox()).toHaveValue('')
      expect(document.activeElement).not.toBe(addBox())
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(createNoteMutate).not.toHaveBeenCalled()
    })

    it('keeps the draft and the row on blur and saves nothing', async () => {
      renderSection()
      await userEvent.type(addBox(), 'half a thought')
      fireEvent.blur(addBox())
      expect(addBox()).toHaveValue('half a thought')
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(createNoteMutate).not.toHaveBeenCalled()
    })

    it('Escape clears the draft', async () => {
      renderSection()
      await userEvent.type(addBox(), 'gone')
      await userEvent.keyboard('{Escape}')
      expect(addBox()).toHaveValue('')
    })

    it('prevents default on pointerdown and mousedown so the buttons do not take focus', async () => {
      renderSection()
      await userEvent.type(addBox(), 'text')
      const save = screen.getByRole('button', { name: 'Save' })
      for (const name of ['Save', 'Cancel']) {
        const btn = screen.getByRole('button', { name })
        expect(fireEvent.pointerDown(btn)).toBe(false)
        expect(fireEvent.mouseDown(btn)).toBe(false)
      }
      expect(document.activeElement).toBe(addBox())
      expect(save).toBeInTheDocument()
    })

    it('scrolls the actions into view when they appear, and tolerates scrollIntoView being absent', async () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      try {
        renderSection()
        await userEvent.click(addBox())
        expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      } finally {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      }
      document.body.innerHTML = ''
      renderSection()
      await userEvent.click(addBox())
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('is not disabled while a note is saving, so the keyboard stays open', () => {
      vi.mocked(useCreateJournalNoteMutation).mockReturnValue({ mutate: createNoteMutate, isPending: true } as never)
      renderSection()
      expect(addBox()).toBeEnabled()
    })
  })

  describe('existing note', () => {
    async function startEditing() {
      loadNotes([note1])
      renderSection()
      await userEvent.click(noteTrigger())
      return screen.getByRole('textbox', { name: 'Edit note' }) as HTMLTextAreaElement
    }

    it('a single tap enters edit mode', async () => {
      const edit = await startEditing()
      expect(edit).toHaveValue('Remember to update docs')
    })

    it('shows Save and Cancel while editing', async () => {
      await startEditing()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('Enter inserts a newline and saves nothing', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '{Enter}more')
      expect(edit).toHaveValue('Remember to update docs\nmore')
      expect(updateNoteMutate).not.toHaveBeenCalled()
    })

    it('Ctrl+Enter saves', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      await userEvent.keyboard('{Control>}{Enter}{/Control}')
      expect(updateNoteMutate).toHaveBeenCalledWith({ id: 1, content: 'Remember to update docs!' })
    })

    it('blur saves once', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      fireEvent.blur(edit)
      fireEvent.blur(edit)
      expect(updateNoteMutate).toHaveBeenCalledTimes(1)
      expect(updateNoteMutate).toHaveBeenCalledWith({ id: 1, content: 'Remember to update docs!' })
    })

    it('Save then blur gives exactly one update and returns focus to the note', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      fireEvent.blur(edit)
      expect(updateNoteMutate).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(noteTrigger())
    })

    it('Cancel then blur saves nothing and Cancel wins', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      fireEvent.blur(edit)
      expect(updateNoteMutate).not.toHaveBeenCalled()
      expect(screen.getByText('Remember to update docs')).toBeInTheDocument()
    })

    it('prevents default on pointerdown and mousedown of the edit buttons', async () => {
      await startEditing()
      for (const name of ['Save', 'Cancel']) {
        const btn = screen.getByRole('button', { name })
        expect(fireEvent.pointerDown(btn)).toBe(false)
        expect(fireEvent.mouseDown(btn)).toBe(false)
      }
    })

    it('disables Save for empty text and does not delete or update on blur', async () => {
      const edit = await startEditing()
      await userEvent.clear(edit)
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      fireEvent.blur(edit)
      expect(updateNoteMutate).not.toHaveBeenCalled()
      expect(deleteNoteMutate).not.toHaveBeenCalled()
      expect(screen.getByText('Remember to update docs')).toBeInTheDocument()
    })

    it('Escape cancels and returns focus to the note', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      await userEvent.keyboard('{Escape}')
      fireEvent.blur(edit)
      expect(updateNoteMutate).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(noteTrigger())
    })

    it('keeps the 2000 limit on the edit textarea', async () => {
      const edit = await startEditing()
      expect(edit).toHaveAttribute('maxlength', '2000')
    })
  })

  it('wraps the row as a note entry', () => {
    loadNotes([note1])
    renderSection()
    expect(noteTrigger().closest('li')).toHaveClass('log-entry', 'note-entry')
  })
})
