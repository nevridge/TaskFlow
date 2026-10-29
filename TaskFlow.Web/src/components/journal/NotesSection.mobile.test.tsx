import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, act } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import userEvent from '@testing-library/user-event'
import type { JournalNoteResponseDto } from '@/api/journal'
import { __resetCoarsePointerCache } from '@/lib/pointer'

const createNoteMutate = vi.fn()
const updateNoteMutate = vi.fn()

vi.mock('@/api/journal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/journal')>()),
  deleteJournalNote: vi.fn(() => Promise.resolve({})),
}))

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: {
    all: ['journal'],
    todos: (id: number) => ['journal', id, 'todos'],
    notes: (id: number) => ['journal', id, 'notes'],
  },
  useJournalNotes: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateJournalNoteMutation: vi.fn(() => ({ mutate: createNoteMutate, isPending: false })),
  useUpdateJournalNoteMutation: vi.fn(() => ({ mutate: updateNoteMutate, isPending: false })),
}))

import { useJournalNotes, useCreateJournalNoteMutation } from '@/hooks/useJournal'
import { deleteJournalNote } from '@/api/journal'
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
      const save = screen.getByRole('button', { name: 'Save' })
      // Blur lands on the still-mounted textarea before React re-renders, as a browser does.
      act(() => {
        fireEvent.click(save)
        fireEvent.blur(edit)
      })
      expect(updateNoteMutate).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(noteTrigger())
    })

    it('Cancel then blur saves nothing and Cancel wins', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      const cancel = screen.getByRole('button', { name: 'Cancel' })
      act(() => {
        fireEvent.click(cancel)
        fireEvent.blur(edit)
      })
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
      expect(deleteJournalNote).not.toHaveBeenCalled()
      expect(screen.getByText('Remember to update docs')).toBeInTheDocument()
    })

    it('Escape cancels and returns focus to the note', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      act(() => {
        fireEvent.keyDown(edit, { key: 'Escape' })
        fireEvent.blur(edit)
      })
      expect(updateNoteMutate).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(noteTrigger())
    })

    it('keeps the 2000 limit on the edit textarea', async () => {
      const edit = await startEditing()
      expect(edit).toHaveAttribute('maxlength', '2000')
    })
  })

  it('reads the pointer mode once per mount: a later change leaves the rendered DOM alone', () => {
    vi.mocked(useCreateJournalNoteMutation).mockReturnValue({ mutate: createNoteMutate, isPending: true } as never)
    const { rerender } = renderSection()
    expect(addBox()).toBeEnabled()
    expect(addBox()).toHaveAttribute('placeholder', 'Add a note')
    setTouch(false)
    rerender(<NotesSection entryId={10} />)
    expect(addBox()).toBeEnabled()
    expect(addBox()).toHaveAttribute('placeholder', 'Add a note')
  })

  describe('focus return expiry', () => {
    afterEach(() => vi.useRealTimers())

    function cancelEditing() {
      loadNotes([note1])
      const utils = renderSection()
      fireEvent.click(noteTrigger())
      act(() => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit note' }), { key: 'Escape' }) })
      return utils
    }

    it('returns focus to the note on re-render while the 100ms window is open', () => {
      vi.useFakeTimers()
      const { rerender } = cancelEditing()
      const text = noteTrigger()
      expect(document.activeElement).toBe(text)
      act(() => { vi.advanceTimersByTime(99); text.blur() })
      rerender(<NotesSection entryId={10} />)
      expect(document.activeElement).toBe(text)
    })

    it('does not pull focus back once the 100ms have elapsed', () => {
      vi.useFakeTimers()
      const { rerender } = cancelEditing()
      const text = noteTrigger()
      act(() => { vi.advanceTimersByTime(100); text.blur() })
      rerender(<NotesSection entryId={10} />)
      expect(document.activeElement).not.toBe(text)
    })
  })

  it('wraps the row as a note entry', () => {
    loadNotes([note1])
    renderSection()
    expect(noteTrigger().closest('li')).toHaveClass('log-entry', 'note-entry')
  })
})
