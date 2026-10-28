import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import type { DailyLogSectionHandle } from './DailyLogSection'

const addLogMutate = vi.fn()
const deleteLogMutate = vi.fn()
const updateLogMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  useAddLogEntryMutation: vi.fn(() => ({ mutate: addLogMutate, isPending: false })),
  useDeleteLogEntryMutation: vi.fn(() => ({ mutate: deleteLogMutate, isPending: false })),
  useUpdateLogEntryMutation: vi.fn(() => ({ mutate: updateLogMutate, isPending: false })),
}))

vi.mock('./TaskTypeahead', () => ({
  TaskTypeahead: vi.fn(({ onChange }: { value: number | null; onChange: (id: number | null) => void }) => (
    <button type="button" data-testid="task-typeahead" onClick={() => onChange(99)}>link-task</button>
  )),
}))

import { useAddLogEntryMutation } from '@/hooks/useJournal'
import { DailyLogSection } from './DailyLogSection'
import type { JournalLogEntryResponseDto } from '@/api/journal'

const baseEntry: JournalLogEntryResponseDto = {
  id: 1,
  content: 'Fixed the bug',
  journalEntryId: 10,
  createdAt: '2026-05-28T09:00:00Z',
  linkedTaskDeleted: false,
}

const secondEntry: JournalLogEntryResponseDto = {
  id: 2,
  content: 'Reviewed PR',
  journalEntryId: 10,
  createdAt: '2026-05-28T10:00:00Z',
  linkedTaskDeleted: false,
}

function renderSection(logEntries: JournalLogEntryResponseDto[] = [], ref?: React.Ref<DailyLogSectionHandle>) {
  return render(<DailyLogSection ref={ref} entryId={10} logEntries={logEntries} />)
}

describe('DailyLogSection', () => {
  beforeEach(() => {
    addLogMutate.mockReset()
    deleteLogMutate.mockReset()
    updateLogMutate.mockReset()
  })

  it('shows empty state when no log entries', () => {
    renderSection([])
    expect(screen.getByText(/no log entries yet/i)).toBeInTheDocument()
  })

  it('renders two log entries', () => {
    renderSection([baseEntry, secondEntry])
    expect(screen.getByText('Fixed the bug')).toBeInTheDocument()
    expect(screen.getByText('Reviewed PR')).toBeInTheDocument()
  })

  it('header shows "2 entries" for two entries', () => {
    renderSection([baseEntry, secondEntry])
    expect(screen.getByText('2 entries')).toBeInTheDocument()
  })

  it('header shows "1 entry" for one entry', () => {
    renderSection([baseEntry])
    expect(screen.getByText('1 entry')).toBeInTheDocument()
  })

  it('submitting trimmed text calls addLog.mutate and clears input', async () => {
    renderSection([])
    const input = screen.getByRole('textbox')
    await userEvent.type(input, '  Working on tests  ')
    await userEvent.keyboard('{Enter}')
    expect(addLogMutate).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Working on tests' }),
      expect.any(Object),
    )
    expect(input).toHaveValue('')
  })

  it('pressing Escape clears the input', async () => {
    renderSection([])
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'some work')
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('clicking delete button calls deleteLog.mutate with entry id', async () => {
    renderSection([baseEntry])
    await userEvent.click(screen.getByRole('button', { name: /delete entry/i }))
    expect(deleteLogMutate).toHaveBeenCalledWith(1)
  })

  it('focusDraftInput() via ref focuses the input', () => {
    const ref = createRef<DailyLogSectionHandle>()
    renderSection([], ref)
    ref.current?.focusDraftInput()
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })

  // ─── Task association display ────────────────────────────────────────────────

  it('renders linked task title chip when linkedTaskTitle is set and linkedTaskDeleted is false', () => {
    const entry: JournalLogEntryResponseDto = {
      ...baseEntry,
      taskItemId: 7,
      linkedTaskTitle: 'Build the feature',
      linkedTaskDeleted: false,
    }
    renderSection([entry])
    expect(screen.getByText('Build the feature')).toBeInTheDocument()
  })

  it('renders muted deleted badge when linkedTaskDeleted is true', () => {
    const entry: JournalLogEntryResponseDto = {
      ...baseEntry,
      taskItemId: null,
      linkedTaskTitle: 'Old deleted task',
      linkedTaskDeleted: true,
    }
    renderSection([entry])
    expect(screen.getByText('Old deleted task (deleted)')).toBeInTheDocument()
  })

  it('renders nothing for task when no taskItemId and no linkedTaskTitle', () => {
    const entry: JournalLogEntryResponseDto = {
      ...baseEntry,
      taskItemId: null,
      linkedTaskTitle: null,
      linkedTaskDeleted: false,
    }
    renderSection([entry])
    expect(screen.queryByText(/deleted/i)).not.toBeInTheDocument()
    // chip text should not appear
    expect(screen.queryByText('Build the feature')).not.toBeInTheDocument()
  })

  it('selecting a task via typeahead calls updateLogMutate with correct payload', async () => {
    renderSection([baseEntry])
    // The component renders two TaskTypeaheads: one per log entry, one for the draft form.
    // Click the first one (the log entry's typeahead) which calls onChange(99).
    const typeaheads = screen.getAllByTestId('task-typeahead')
    await userEvent.click(typeaheads[0])
    expect(updateLogMutate).toHaveBeenCalledWith({ id: baseEntry.id, content: baseEntry.content, taskItemId: 99 })
  })

  // ─── Text editing ────────────────────────────────────────────────────────────

  describe('log text editing', () => {
    const linked: JournalLogEntryResponseDto = { ...baseEntry, taskItemId: 7, linkedTaskTitle: 'Build the feature' }
    const trigger = (name = 'Fixed the bug') => screen.getByRole('button', { name })
    const editBox = () => screen.getByRole('textbox', { name: 'Edit log entry' })

    async function startEditing(entry = linked) {
      renderSection([entry])
      await userEvent.dblClick(trigger(entry.content))
      return editBox()
    }

    it('a single click does not edit on desktop, a double-click does, in place of the text', async () => {
      renderSection([baseEntry])
      await userEvent.click(trigger())
      expect(screen.queryByRole('textbox', { name: 'Edit log entry' })).not.toBeInTheDocument()
      await userEvent.dblClick(trigger())
      expect(editBox()).toHaveValue('Fixed the bug')
      expect(editBox().closest('.log-body')).not.toBeNull()
      expect(screen.queryByRole('button', { name: 'Fixed the bug' })).not.toBeInTheDocument()
    })

    it.each(['{Enter}', ' '])('keyboard %j on the focused text starts editing', async key => {
      renderSection([baseEntry])
      trigger().focus()
      await userEvent.keyboard(key)
      expect(editBox()).toHaveValue('Fixed the bug')
    })

    it('the edit input has the same max length as the add input', async () => {
      const edit = await startEditing()
      expect(edit).toHaveAttribute('maxlength', '2000')
      expect(screen.getByPlaceholderText(/what did you just work on/i)).toHaveAttribute('maxlength', '2000')
    })

    it('Enter commits once with the existing taskItemId and returns focus to the text', async () => {
      const edit = await startEditing()
      await userEvent.clear(edit)
      await userEvent.type(edit, '  Fixed the other bug  {Enter}')
      expect(updateLogMutate).toHaveBeenCalledTimes(1)
      expect(updateLogMutate).toHaveBeenCalledWith({ id: 1, content: 'Fixed the other bug', taskItemId: 7 })
      expect(document.activeElement).toBe(trigger())
    })

    it('sends taskItemId null, never undefined, for an unlinked entry', async () => {
      const edit = await startEditing(baseEntry)
      await userEvent.type(edit, '!{Enter}')
      expect(updateLogMutate).toHaveBeenCalledWith({ id: 1, content: 'Fixed the bug!', taskItemId: null })
    })

    it('Enter then blur does not commit twice', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      // Blur lands on the still-mounted input before React re-renders, as a browser does.
      act(() => {
        fireEvent.keyDown(edit, { key: 'Enter' })
        fireEvent.blur(edit)
      })
      expect(updateLogMutate).toHaveBeenCalledTimes(1)
    })

    it('blur commits', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      fireEvent.blur(edit)
      expect(updateLogMutate).toHaveBeenCalledWith({ id: 1, content: 'Fixed the bug!', taskItemId: 7 })
    })

    it('Escape then blur saves nothing and restores the text', async () => {
      const edit = await startEditing()
      await userEvent.type(edit, '!')
      act(() => {
        fireEvent.keyDown(edit, { key: 'Escape' })
        fireEvent.blur(edit)
      })
      expect(updateLogMutate).not.toHaveBeenCalled()
      expect(trigger()).toBeInTheDocument()
      expect(document.activeElement).toBe(trigger())
    })

    it('empty text saves nothing and restores the original', async () => {
      const edit = await startEditing()
      await userEvent.clear(edit)
      await userEvent.keyboard('{Enter}')
      expect(updateLogMutate).not.toHaveBeenCalled()
      expect(trigger()).toHaveTextContent('Fixed the bug')
    })

    it('unchanged text saves nothing', async () => {
      await startEditing()
      await userEvent.keyboard('{Enter}')
      expect(updateLogMutate).not.toHaveBeenCalled()
    })

    it('tapping delete does not enter edit mode', async () => {
      renderSection([linked])
      await userEvent.click(screen.getByRole('button', { name: /delete entry/i }))
      expect(screen.queryByRole('textbox', { name: 'Edit log entry' })).not.toBeInTheDocument()
    })

    it('tapping the chip or typeahead does not enter edit mode', async () => {
      renderSection([linked])
      await userEvent.dblClick(screen.getByText('Build the feature'))
      await userEvent.click(screen.getAllByTestId('task-typeahead')[0])
      expect(screen.queryByRole('textbox', { name: 'Edit log entry' })).not.toBeInTheDocument()
    })

    it('relinking while editing: blur commits the text, then the relink sends the committed content', async () => {
      const { rerender } = renderSection([linked])
      await userEvent.dblClick(trigger())
      await userEvent.type(editBox(), '!')
      // Focusing the typeahead blurs the edit input first, which commits the text.
      fireEvent.blur(editBox())
      expect(updateLogMutate).toHaveBeenCalledTimes(1)
      expect(updateLogMutate).toHaveBeenNthCalledWith(1, { id: 1, content: 'Fixed the bug!', taskItemId: 7 })
      // The optimistic cache update flows back as new props; the relink reads the latest entry, not a captured one.
      rerender(<DailyLogSection entryId={10} logEntries={[{ ...linked, content: 'Fixed the bug!' }]} />)
      await userEvent.click(screen.getAllByTestId('task-typeahead')[0])
      expect(updateLogMutate).toHaveBeenNthCalledWith(2, { id: 1, content: 'Fixed the bug!', taskItemId: 99 })
    })

    it('commits the text with the latest cached taskItemId, not the one from when editing began', async () => {
      const { rerender } = renderSection([linked])
      await userEvent.dblClick(trigger())
      await userEvent.type(editBox(), '!')
      rerender(<DailyLogSection entryId={10} logEntries={[{ ...linked, taskItemId: 55 }]} />)
      await userEvent.keyboard('{Enter}')
      expect(updateLogMutate).toHaveBeenCalledWith({ id: 1, content: 'Fixed the bug!', taskItemId: 55 })
    })

    it('keeps the typeahead mounted when the text swaps to the editor', async () => {
      renderSection([linked])
      const before = screen.getAllByTestId('task-typeahead')[0]
      await userEvent.dblClick(trigger())
      expect(screen.getAllByTestId('task-typeahead')[0]).toBe(before)
    })
  })

  describe('add row', () => {
    it('renders an Add submit button that is disabled until there is text and submits', async () => {
      renderSection([])
      const add = screen.getByRole('button', { name: 'Add' })
      expect(add).toHaveAttribute('type', 'submit')
      expect(add).toBeDisabled()
      await userEvent.type(screen.getByRole('textbox'), 'did a thing')
      expect(add).toBeEnabled()
      await userEvent.click(add)
      expect(addLogMutate).toHaveBeenCalledWith(expect.objectContaining({ content: 'did a thing' }), expect.any(Object))
    })

    it('disables the add input while saving on desktop', () => {
      vi.mocked(useAddLogEntryMutation).mockReturnValueOnce({ mutate: addLogMutate, isPending: true } as never)
      renderSection([])
      expect(screen.getByRole('textbox')).toBeDisabled()
    })

    it('prevents default on pointerdown and mousedown of Add so the input keeps focus', async () => {
      renderSection([])
      await userEvent.type(screen.getByRole('textbox'), 'text')
      const add = screen.getByRole('button', { name: 'Add' })
      expect(fireEvent.pointerDown(add)).toBe(false)
      expect(fireEvent.mouseDown(add)).toBe(false)
    })
  })
})
