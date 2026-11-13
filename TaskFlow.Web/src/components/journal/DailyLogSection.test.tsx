import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, act } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import type { DailyLogSectionHandle } from './DailyLogSection'

const addLogMutate = vi.fn()
const updateLogMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: {
    all: ['journal'],
    todos: (id: number) => ['journal', id, 'todos'],
    notes: (id: number) => ['journal', id, 'notes'],
  },
  useAddLogEntryMutation: vi.fn(() => ({ mutate: addLogMutate, isPending: false })),
  useUpdateLogEntryMutation: vi.fn(() => ({ mutate: updateLogMutate, isPending: false })),
}))

vi.mock('@/api/journal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/journal')>()),
  deleteLogEntry: vi.fn(() => Promise.resolve({})),
}))

vi.mock('./TaskTypeahead', () => ({
  TaskTypeahead: vi.fn(({ onChange }: { value: number | null; onChange: (id: number | null) => void }) => (
    <button type="button" data-testid="task-typeahead" onClick={() => onChange(99)}>link-task</button>
  )),
}))

import { useAddLogEntryMutation } from '@/hooks/useJournal'
import { deleteLogEntry } from '@/api/journal'
import { DailyLogSection } from './DailyLogSection'
import { STACKED_QUERY } from '@/hooks/useStackedLayout'
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

const logRow = (content: string) => screen.getByText(content).closest('li')!
const deleteBtn = (content: string) => logRow(content).querySelector<HTMLElement>('[data-log-x]')!

describe('DailyLogSection', () => {
  beforeEach(() => {
    addLogMutate.mockReset()
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

  it('clicking delete hides the entry at once and calls deleteLogEntry after the undo window', () => {
    vi.useFakeTimers()
    try {
      renderSection([baseEntry])
      fireEvent.click(screen.getByRole('button', { name: /delete entry/i }))
      expect(screen.queryByRole('button', { name: /delete entry/i })).not.toBeInTheDocument()
      expect(screen.getByText('0 entries')).toBeInTheDocument()
      expect(deleteLogEntry).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(6000) })
      expect(deleteLogEntry).toHaveBeenCalledTimes(1)
      expect(deleteLogEntry).toHaveBeenCalledWith(10, 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Undo restores the entry and never calls the API', () => {
    vi.useFakeTimers()
    try {
      renderSection([baseEntry])
      fireEvent.click(screen.getByRole('button', { name: /delete entry/i }))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(screen.getByRole('button', { name: /delete entry/i })).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(10000) })
      expect(deleteLogEntry).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves focus to the next older entry delete button, or the add input when none is left', () => {
    const older = { ...baseEntry, id: 1, content: 'Older', createdAt: '2026-05-28T09:00:00Z' }
    const newer = { ...baseEntry, id: 2, content: 'Newer', createdAt: '2026-05-28T10:00:00Z' }
    renderSection([older, newer])
    // Newest first: deleting the top entry moves focus down to the older one.
    fireEvent.click(deleteBtn('Newer'))
    expect(deleteBtn('Older')).toHaveFocus()
    fireEvent.click(deleteBtn('Older'))
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  describe('order and layout', () => {
    const texts = () => Array.from(document.querySelectorAll('.log-text')).map(n => n.textContent)
    const entry = (id: number, content: string, createdAt: string) => ({ ...baseEntry, id, content, createdAt })

    it('lists entries newest first, whatever order they arrive in', () => {
      renderSection([
        entry(1, 'a', '2026-05-28T09:00:00Z'),
        entry(2, 'b', '2026-05-28T11:00:00Z'),
        entry(3, 'c', '2026-05-28T10:00:00Z'),
      ])
      expect(texts()).toEqual(['b', 'c', 'a'])
    })

    it('puts the higher id first when createdAt is identical', () => {
      const t = '2026-05-28T09:00:00Z'
      renderSection([entry(1, 'one', t), entry(3, 'three', t), entry(2, 'two', t)])
      expect(texts()).toEqual(['three', 'two', 'one'])
    })

    it('falls back to id descending when a createdAt cannot be parsed', () => {
      renderSection([entry(1, 'one', '2026-05-28T12:00:00Z'), entry(2, 'two', 'not a date')])
      expect(texts()).toEqual(['two', 'one'])
    })

    it('orders by absolute instant when createdAt carries different UTC offsets', () => {
      // 10:00+02:00 is 08:00Z, earlier than 09:00Z even though its clock text is later.
      renderSection([
        entry(1, 'earlier', '2026-05-28T10:00:00+02:00'),
        entry(2, 'later', '2026-05-28T09:00:00Z'),
      ])
      expect(texts()).toEqual(['later', 'earlier'])
    })

    it('does not reorder the array it was given', () => {
      const input = [entry(1, 'a', '2026-05-28T09:00:00Z'), entry(2, 'b', '2026-05-28T10:00:00Z')]
      renderSection(input)
      expect(input.map(e => e.id)).toEqual([1, 2])
    })

    it('keeps an edited entry in place', () => {
      const a = entry(1, 'a', '2026-05-28T09:00:00Z')
      const b = entry(2, 'b', '2026-05-28T10:00:00Z')
      const { rerender } = renderSection([a, b])
      rerender(<DailyLogSection entryId={10} logEntries={[{ ...a, content: 'a edited' }, b]} />)
      expect(texts()).toEqual(['b', 'a edited'])
    })

    it('puts the add form before the list in the DOM, outside the scroll region', () => {
      renderSection([baseEntry])
      const input = screen.getByRole('textbox')
      const region = screen.getByRole('region', { name: 'Daily log' })
      expect(input.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(region).not.toContainElement(input)
      expect(region).toContainElement(screen.getByText('Fixed the bug'))
    })

    it('restores an undone entry to its sorted slot', () => {
      vi.useFakeTimers()
      try {
        renderSection([
          entry(1, 'a', '2026-05-28T09:00:00Z'),
          entry(2, 'b', '2026-05-28T10:00:00Z'),
          entry(3, 'c', '2026-05-28T11:00:00Z'),
        ])
        fireEvent.click(deleteBtn('b'))
        expect(texts()).toEqual(['c', 'a'])
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
        expect(texts()).toEqual(['c', 'b', 'a'])
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('points the empty state at the add input above the list', () => {
    renderSection([])
    expect(screen.getByText(/capture what you worked on above/)).toBeInTheDocument()
  })

  describe('scroll region', () => {
    afterEach(() => {
      Reflect.deleteProperty(window, 'matchMedia')
    })

    function mockStacked(initial: boolean) {
      let matches = initial
      const listeners = new Set<() => void>()
      const matchMedia = vi.fn((query: string) => ({
        media: query,
        get matches() { return query === STACKED_QUERY && matches },
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
      }))
      Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true })
      return (next: boolean) => {
        matches = next
        act(() => listeners.forEach(l => l()))
      }
    }

    const region = () => screen.getByRole('region', { name: 'Daily log' })

    it('is a focusable region named "Daily log" on desktop, and nothing else has that name', () => {
      renderSection([baseEntry])
      expect(region()).toHaveAttribute('tabindex', '0')
      expect(screen.getAllByLabelText('Daily log')).toHaveLength(1)
    })

    it('has no tabindex when the layout is stacked', () => {
      mockStacked(true)
      renderSection([baseEntry])
      expect(region()).not.toHaveAttribute('tabindex')
    })

    it('toggles tabindex on a breakpoint change without remounting, keeping the draft and input focus', async () => {
      const setStacked = mockStacked(false)
      renderSection([baseEntry])
      const before = region()
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'half typed')
      setStacked(true)
      expect(region()).toBe(before)
      expect(before).not.toHaveAttribute('tabindex')
      expect(input).toHaveValue('half typed')
      expect(input).toHaveFocus()
      setStacked(false)
      expect(before).toHaveAttribute('tabindex', '0')
    })

    it('moves focus from the region to the add input when the layout stacks', () => {
      const setStacked = mockStacked(false)
      renderSection([baseEntry])
      region().focus()
      setStacked(true)
      expect(screen.getByRole('textbox')).toHaveFocus()
    })

    it('leaves focus alone on a breakpoint change when the region is not focused', () => {
      const setStacked = mockStacked(false)
      renderSection([baseEntry])
      const del = screen.getByRole('button', { name: /delete entry/i })
      del.focus()
      setStacked(true)
      expect(del).toHaveFocus()
    })

    describe('after adding', () => {
      const submit = async (text: string) => {
        await userEvent.type(screen.getByRole('textbox'), text)
        await userEvent.keyboard('{Enter}')
        return addLogMutate.mock.calls.at(-1)![1] as { onSuccess: () => void; onError: () => void }
      }

      it('scrolls to the top as soon as the add succeeds and again when the new entry renders, repeatably', async () => {
        const first = { ...baseEntry, id: 1 }
        const { rerender } = renderSection([first])
        let newest = first
        for (const id of [2, 3]) {
          region().scrollTop = 80
          const options = await submit(`new ${id}`)
          act(() => options.onSuccess())
          expect(region().scrollTop).toBe(0)
          expect(screen.getByRole('textbox')).toHaveFocus()
          // The refetch lands after onSuccess: the list changes and the browser may have scrolled it again.
          region().scrollTop = 80
          const added = { ...baseEntry, id, content: `n${id}`, createdAt: `2026-05-29T0${id}:00:00Z` }
          rerender(<DailyLogSection entryId={10} logEntries={[first, newest, added].filter((e, i, a) => a.indexOf(e) === i)} />)
          expect(region().scrollTop).toBe(0)
          newest = added
        }
      })

      it('does not leave the scroll pending when the refetch landed before onSuccess', async () => {
        const first = { ...baseEntry, id: 1 }
        const { rerender } = renderSection([first])
        const options = await submit('quick')
        // The refetch renders the new entry first, then the mutation callback runs.
        const added = { ...baseEntry, id: 2, content: 'n2', createdAt: '2026-05-29T09:00:00Z' }
        rerender(<DailyLogSection entryId={10} logEntries={[first, added]} />)
        act(() => options.onSuccess())
        region().scrollTop = 60
        // A later change of the newest entry must not jump the list.
        rerender(<DailyLogSection entryId={10} logEntries={[first, { ...added, id: 3, createdAt: '2026-05-29T10:00:00Z' }]} />)
        expect(region().scrollTop).toBe(60)
      })

      it('a failed add keeps the draft and a later newest entry does not scroll the list', async () => {
        const first = { ...baseEntry, id: 1 }
        const { rerender } = renderSection([first])
        const options = await submit('oops')
        act(() => options.onError())
        expect(screen.getByRole('textbox')).toHaveValue('oops')
        region().scrollTop = 50
        rerender(<DailyLogSection entryId={10} logEntries={[first, { ...baseEntry, id: 5, createdAt: '2026-05-29T09:00:00Z' }]} />)
        expect(region().scrollTop).toBe(50)
      })
    })
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
    // The component renders the draft form's TaskTypeahead first, then one per log entry.
    // Click the second one (the log entry's typeahead) which calls onChange(99).
    const typeaheads = screen.getAllByTestId('task-typeahead')
    await userEvent.click(typeaheads[1])
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
      await userEvent.click(screen.getAllByTestId('task-typeahead')[1])
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
      await userEvent.click(screen.getAllByTestId('task-typeahead')[1])
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
      const before = screen.getAllByTestId('task-typeahead')[1]
      await userEvent.dblClick(trigger())
      expect(screen.getAllByTestId('task-typeahead')[1]).toBe(before)
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

    // The draft's typeahead is the first one rendered (the form sits above the list).
    const clickDraftTypeahead = () => fireEvent.click(screen.getAllByTestId('task-typeahead')[0])
    const failLastAdd = () => {
      const options = addLogMutate.mock.calls.at(-1)![1] as { onError: () => void }
      act(() => options.onError())
    }

    it('failed add with nothing newer typed restores the text and the linked task', async () => {
      renderSection([])
      const input = screen.getByRole('textbox')
      clickDraftTypeahead()
      await userEvent.type(input, 'first')
      await userEvent.keyboard('{Enter}')
      expect(input).toHaveValue('')

      failLastAdd()
      expect(input).toHaveValue('first')
      expect(input).toHaveFocus()

      await userEvent.keyboard('{Enter}')
      expect(addLogMutate).toHaveBeenLastCalledWith({ content: 'first', taskItemId: 99 }, expect.any(Object))
    })

    it('failed add does not overwrite text typed while the save was in flight, nor restore the old link', async () => {
      renderSection([])
      const input = screen.getByRole('textbox')
      clickDraftTypeahead()
      await userEvent.type(input, 'first')
      await userEvent.keyboard('{Enter}')
      await userEvent.type(input, 'second')

      failLastAdd()
      expect(input).toHaveValue('second')

      await userEvent.keyboard('{Enter}')
      expect(addLogMutate).toHaveBeenLastCalledWith({ content: 'second', taskItemId: null }, expect.any(Object))
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
