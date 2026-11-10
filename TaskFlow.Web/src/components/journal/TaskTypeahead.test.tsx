import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

const mockTasks: Array<{ id: number; title: string; status: string }> = [
  { id: 1, title: 'Fix login bug', status: 'Todo' },
  { id: 2, title: 'Write tests', status: 'Todo' },
  { id: 3, title: 'Deploy to production', status: 'Completed' },
]

vi.mock('@/hooks/useTasks', () => ({
  useTasksQuery: vi.fn(() => ({
    data: { data: mockTasks },
  })),
}))

import { TaskTypeahead } from './TaskTypeahead'
import { useTasksQuery } from '@/hooks/useTasks'
import { __resetCoarsePointerCache } from '@/lib/pointer'

function renderTypeahead(value: number | null, onChange = vi.fn()) {
  return { onChange, ...render(<TaskTypeahead value={value} onChange={onChange} />) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TaskTypeahead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the input with placeholder when no value is set', () => {
    renderTypeahead(null)
    expect(screen.getByPlaceholderText('Link to task…')).toBeInTheDocument()
  })

  it('shows the selected task title as input value when value is set', () => {
    renderTypeahead(2)
    expect(screen.getByRole('combobox')).toHaveValue('Write tests')
  })

  it('opens dropdown on focus', async () => {
    renderTypeahead(null)
    await userEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('filters tasks by title substring', async () => {
    renderTypeahead(null)
    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    await userEvent.type(input, 'test')
    const options = screen.getAllByRole('option')
    // Should show "None" + "Write tests" only
    const optionTexts = options.map(o => o.textContent)
    expect(optionTexts).toContain('#2 Write tests')
    expect(optionTexts.join('|')).not.toContain('Fix login bug')
    expect(optionTexts.join('|')).not.toContain('Deploy to production')
  })

  it('calls onChange with null when None is selected', async () => {
    const onChange = vi.fn()
    render(<TaskTypeahead value={1} onChange={onChange} />)
    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    const noneOption = screen.getByText('None')
    await userEvent.click(noneOption)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('calls onChange with task id when a task is selected', async () => {
    const onChange = vi.fn()
    render(<TaskTypeahead value={null} onChange={onChange} />)
    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    await userEvent.type(input, 'test')
    const option = screen.getByText('Write tests')
    await userEvent.click(option)
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('shows "No matching tasks" when filter yields no results', async () => {
    renderTypeahead(null)
    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    await userEvent.type(input, 'zzznomatch')
    expect(screen.getByText('No matching tasks')).toBeInTheDocument()
  })

  describe('keyboard navigation', () => {
    it('ArrowDown highlights first option (None)', async () => {
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      // Dropdown is open from focus with activeIndex = -1; ArrowDown should move to None
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      await userEvent.keyboard('{ArrowDown}')
      expect(screen.getByText('None')).toHaveClass('active')
    })

    it('ArrowDown moves highlight through options', async () => {
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      await userEvent.keyboard('{ArrowDown}')
      // activeIndex = 0 → "None" is active
      expect(screen.getByText('None')).toHaveClass('active')
      await userEvent.keyboard('{ArrowDown}')
      // activeIndex = 1 → first task option is active
      const options = screen.getAllByRole('option')
      expect(options[1]).toHaveClass('active')
    })

    it('ArrowUp does not go below index 0', async () => {
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      await userEvent.keyboard('{ArrowDown}')
      // activeIndex = 0
      await userEvent.keyboard('{ArrowUp}')
      // should stay at 0
      expect(screen.getByText('None')).toHaveClass('active')
    })

    it('Escape closes dropdown and clears active index', async () => {
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('Enter selects None when activeIndex is 0', async () => {
      const onChange = vi.fn()
      render(<TaskTypeahead value={1} onChange={onChange} />)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      await userEvent.keyboard('{ArrowDown}')
      // activeIndex = 0 → None
      await userEvent.keyboard('{Enter}')
      expect(onChange).toHaveBeenCalledWith(null)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('Enter selects highlighted task option', async () => {
      const onChange = vi.fn()
      render(<TaskTypeahead value={null} onChange={onChange} />)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      // ArrowDown x2: index 0 = None, index 1 = Fix login bug
      await userEvent.keyboard('{ArrowDown}')
      await userEvent.keyboard('{ArrowDown}')
      await userEvent.keyboard('{Enter}')
      expect(onChange).toHaveBeenCalledWith(1)
    })

    it('Enter propagates normally when activeIndex is -1', async () => {
      const onChange = vi.fn()
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
      render(
        <form onSubmit={onSubmit}>
          <TaskTypeahead value={null} onChange={onChange} />
          <button type="submit">Submit</button>
        </form>
      )
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      // Dropdown is open but activeIndex = -1; Enter should propagate to the form
      await userEvent.keyboard('{Enter}')
      expect(onSubmit).toHaveBeenCalled()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('filtering resets activeIndex to -1', async () => {
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      await userEvent.keyboard('{ArrowDown}')
      // activeIndex = 0, None is active
      expect(screen.getByText('None')).toHaveClass('active')
      // Now type to filter — activeIndex should reset
      await userEvent.type(input, 'test')
      expect(screen.getByText('None')).not.toHaveClass('active')
    })
  })

  describe('touch and focus handling', () => {
    afterEach(() => {
      vi.useRealTimers()
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      Reflect.deleteProperty(window, 'matchMedia')
      __resetCoarsePointerCache()
    })

    it('prevents the default of mousedown on the listbox so the input keeps focus', async () => {
      renderTypeahead(null)
      await userEvent.click(screen.getByRole('combobox'))
      expect(fireEvent.mouseDown(screen.getByRole('listbox'))).toBe(false)
    })

    it('selects an option clicked after the input blurs, within the 150ms close delay', () => {
      vi.useFakeTimers()
      const { onChange } = renderTypeahead(null)
      const input = screen.getByRole('combobox')
      fireEvent.focus(input)
      fireEvent.blur(input)
      act(() => { vi.advanceTimersByTime(100) })
      fireEvent.click(screen.getByText('Write tests'))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(2)
    })

    it('closes 150ms after blur', () => {
      vi.useFakeTimers()
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      fireEvent.focus(input)
      fireEvent.blur(input)
      act(() => { vi.advanceTimersByTime(149) })
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('refocusing before the delay keeps the list open', () => {
      vi.useFakeTimers()
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      fireEvent.focus(input)
      fireEvent.blur(input)
      act(() => { vi.advanceTimersByTime(100) })
      fireEvent.focus(input)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    it('clears the pending close timer on unmount', () => {
      vi.useFakeTimers()
      const { unmount } = renderTypeahead(null)
      const input = screen.getByRole('combobox')
      fireEvent.focus(input)
      fireEvent.blur(input)
      expect(vi.getTimerCount()).toBe(1)
      unmount()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('reopens on click after a selection leaves the input focused', async () => {
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      await userEvent.click(screen.getByText('Write tests'))
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(document.activeElement).toBe(input)
      await userEvent.click(input)
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    it('wires combobox ARIA: aria-controls, aria-activedescendant, autocomplete off', async () => {
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      expect(input).toHaveAttribute('autocomplete', 'off')
      await userEvent.click(input)
      expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
      expect(input).not.toHaveAttribute('aria-activedescendant')
      await userEvent.keyboard('{ArrowDown}{ArrowDown}')
      const activeId = input.getAttribute('aria-activedescendant')
      expect(activeId).toBeTruthy()
      expect(document.getElementById(activeId as string)).toHaveTextContent('Fix login bug')
    })

    function stubTouch(touch: boolean) {
      Object.defineProperty(window, 'matchMedia', {
        value: vi.fn().mockReturnValue({ matches: touch }),
        configurable: true,
        writable: true,
      })
      __resetCoarsePointerCache()
    }

    it('on touch scrolls the dropdown into view when it opens, and the active option', async () => {
      stubTouch(true)
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      renderTypeahead(null)
      await userEvent.click(screen.getByRole('combobox'))
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      scroll.mockClear()
      await userEvent.keyboard('{ArrowDown}')
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    })

    it('on desktop does not scroll the dropdown into view on open', async () => {
      stubTouch(false)
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      renderTypeahead(null)
      await userEvent.click(screen.getByRole('combobox'))
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(scroll).not.toHaveBeenCalled()
    })

    it('does not give the empty-state row an option role', async () => {
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      await userEvent.type(input, 'zzznomatch')
      expect(screen.getAllByRole('option')).toHaveLength(1)
    })
  })

  describe('select prefilled title (#480)', () => {
    const TITLE = 'Write tests' // task 2
    const getInput = () => screen.getByRole('combobox') as HTMLInputElement
    const expectFullySelected = (input: HTMLInputElement, length = TITLE.length) => {
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(length)
    }

    afterEach(() => {
      vi.useRealTimers()
      Reflect.deleteProperty(window, 'matchMedia')
      __resetCoarsePointerCache()
    })

    function Controlled({ onChange }: { onChange: (id: number | null) => void }) {
      const [value, setValue] = useState<number | null>(2)
      return (
        <TaskTypeahead
          value={value}
          onChange={id => {
            onChange(id)
            setValue(id)
          }}
        />
      )
    }

    it('selects the title when tabbing into a linked input and opens the list', async () => {
      const { onChange } = renderTypeahead(2)
      await userEvent.tab()
      expect(document.activeElement).toBe(getInput())
      expectFullySelected(getInput())
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('selects the title when clicking an unfocused linked input', async () => {
      const { onChange } = renderTypeahead(2)
      await userEvent.click(getInput())
      expectFullySelected(getInput())
      expect(onChange).not.toHaveBeenCalled()
    })

    it('re-selects after the browser overwrites the focus selection with a caret (real mouse order)', () => {
      renderTypeahead(2)
      const input = getInput()
      fireEvent.mouseDown(input)
      fireEvent.focus(input)
      input.setSelectionRange(3, 3)
      fireEvent.mouseUp(input)
      fireEvent.click(input)
      expectFullySelected(input)
    })

    it('replaces the title with the first typed characters after Tab-in', async () => {
      renderTypeahead(2)
      await userEvent.tab()
      await userEvent.keyboard('42')
      expect(getInput()).toHaveValue('42')
    })

    it('filters by the typed ID over the selected title so the ID match is listed first (AC 3)', async () => {
      renderTypeahead(1) // linked to "Fix login bug"; type task 2's ID
      await userEvent.tab()
      await userEvent.keyboard('2')
      expect(getInput()).toHaveValue('2')
      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(2) // None + the ID match only
      expect(options[1]).toHaveTextContent('#2 Write tests')
    })

    it('replaces the title with the first typed character after click-in', async () => {
      renderTypeahead(2)
      await userEvent.click(getInput())
      await userEvent.keyboard('x')
      expect(getInput()).toHaveValue('x')
    })

    it('does not run journal shortcuts while typing over the selected title', async () => {
      const { isInputFocused } = await import('@/lib/keyboard-utils')
      const fired = vi.fn()
      const listener = (e: KeyboardEvent) => {
        if (isInputFocused()) return
        fired(e.key)
      }
      document.addEventListener('keydown', listener)
      try {
        renderTypeahead(2)
        await userEvent.tab()
        fired.mockClear() // the Tab keydown itself happens before the input has focus
        await userEvent.keyboard('tln')
        expect(getInput()).toHaveValue('tln')
        expect(fired).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('keydown', listener)
      }
    })

    it('Backspace after focus empties the field and lists all tasks without unlinking', async () => {
      const { onChange } = renderTypeahead(2)
      await userEvent.tab()
      await userEvent.keyboard('{Backspace}')
      expect(getInput()).toHaveValue('')
      expect(screen.getAllByRole('option')).toHaveLength(mockTasks.length + 1)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('does not unlink when the cleared field blurs', () => {
      vi.useFakeTimers()
      const { onChange } = renderTypeahead(2)
      const input = getInput()
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.blur(input)
      act(() => { vi.advanceTimersByTime(200) })
      expect(onChange).not.toHaveBeenCalled()
    })

    it('keeps the caret when clicking an already focused input with the list open', async () => {
      renderTypeahead(2)
      await userEvent.tab()
      const input = getInput()
      fireEvent.mouseDown(input)
      input.setSelectionRange(2, 2)
      fireEvent.mouseUp(input)
      fireEvent.click(input)
      expect(input.selectionStart).toBe(2)
      expect(input.selectionEnd).toBe(2)
    })

    it('reopens and selects the new title when clicking the focused input after choosing an option', async () => {
      const onChange = vi.fn()
      render(<Controlled onChange={onChange} />)
      await userEvent.click(getInput())
      await userEvent.keyboard('{Backspace}') // clear the filter so the other task is listed
      await userEvent.click(screen.getByRole('option', { name: '#1 Fix login bug' }))
      expect(onChange).toHaveBeenCalledWith(1)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(document.activeElement).toBe(getInput())
      await userEvent.click(getInput())
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(getInput()).toHaveValue('Fix login bug')
      expectFullySelected(getInput(), 'Fix login bug'.length)
    })

    it('selects the title again on Shift+Tab back into the row', async () => {
      render(
        <>
          <button>before</button>
          <TaskTypeahead value={2} onChange={vi.fn()} />
          <button>after</button>
        </>,
      )
      await userEvent.tab()
      await userEvent.tab()
      expectFullySelected(getInput())
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(document.activeElement).toBe(getInput())
      expectFullySelected(getInput())
    })

    it('leaves an unlinked row empty with a collapsed selection on focus and click', async () => {
      renderTypeahead(null)
      await userEvent.tab()
      const input = getInput()
      expect(input).toHaveValue('')
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(0)
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      await userEvent.click(input)
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(0)
    })

    it('keeps a drag or double-click selection instead of turning it into select-all', () => {
      renderTypeahead(2)
      const input = getInput()
      fireEvent.mouseDown(input)
      fireEvent.focus(input)
      input.setSelectionRange(1, 4)
      fireEvent.mouseUp(input)
      fireEvent.click(input)
      expect(input.selectionStart).toBe(1)
      expect(input.selectionEnd).toBe(4)
    })

    it('Escape closes the list and the blur close still fires after 150ms', () => {
      vi.useFakeTimers()
      renderTypeahead(2)
      const input = getInput()
      fireEvent.focus(input)
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      fireEvent.focus(input)
      fireEvent.blur(input)
      act(() => { vi.advanceTimersByTime(149) })
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('does not use a stale click flag: a mousedown without click does not select on a later keyboard focus click', () => {
      renderTypeahead(2)
      const input = getInput()
      fireEvent.mouseDown(input) // flag true, no click follows (e.g. drag out)
      fireEvent.focus(input) // keyboard-style focus path still selects
      expectFullySelected(input)
      input.setSelectionRange(2, 2)
      fireEvent.mouseDown(input) // list open now, so the flag is recomputed to false
      fireEvent.click(input)
      expect(input.selectionStart).toBe(2)
      expect(input.selectionEnd).toBe(2)
    })

    it('still selects on a coarse pointer', async () => {
      Object.defineProperty(window, 'matchMedia', {
        value: vi.fn().mockReturnValue({ matches: true }),
        configurable: true,
        writable: true,
      })
      __resetCoarsePointerCache()
      renderTypeahead(2)
      await userEvent.click(getInput())
      expectFullySelected(getInput())
    })

    it('only places the caret when refocusing within the 150ms blur window (accepted)', () => {
      vi.useFakeTimers()
      renderTypeahead(2)
      const input = getInput()
      fireEvent.focus(input)
      fireEvent.blur(input)
      act(() => { vi.advanceTimersByTime(100) })
      fireEvent.mouseDown(input) // list still open, flag false
      fireEvent.focus(input)
      input.setSelectionRange(3, 3)
      fireEvent.click(input)
      expect(input.selectionStart).toBe(3)
      expect(input.selectionEnd).toBe(3)
    })
  })

  describe('blocked badge', () => {
    it('shows a Blocked badge only on blocked rows', async () => {
      mockTasks.push({ id: 4, title: 'Stuck task', status: 'Blocked' })
      try {
        renderTypeahead(null)
        await userEvent.click(screen.getByRole('combobox'))
        const stuck = screen.getByText('Stuck task').closest('li') as HTMLElement
        expect(stuck).toHaveTextContent('Blocked')
        const other = screen.getByText('Fix login bug').closest('li') as HTMLElement
        expect(other).not.toHaveTextContent('Blocked')
      } finally {
        mockTasks.pop()
      }
    })
  })

  describe('search by task ID (#423)', () => {
    const originalTasks = [...mockTasks]
    const optionNames = () => screen.getAllByRole('option').map(o => o.textContent)
    const open = async () => {
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      return input
    }

    afterEach(() => {
      mockTasks.splice(0, mockTasks.length, ...originalTasks)
      vi.mocked(useTasksQuery).mockImplementation(
        () => ({ data: { data: mockTasks } }) as unknown as ReturnType<typeof useTasksQuery>,
      )
    })

    it('shows #id, title and Blocked badge on each option, with accessible name "#4 Stuck task Blocked"', async () => {
      mockTasks.push({ id: 4, title: 'Stuck task', status: 'Blocked' })
      renderTypeahead(null)
      await open()
      expect(screen.getByRole('option', { name: '#4 Stuck task Blocked' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: '#1 Fix login bug' })).toBeInTheDocument()
    })

    it.each(['2', '#2', '002'])('lists the ID match for "%s" and highlights it; Enter selects it', async text => {
      const { onChange } = renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, text)
      expect(optionNames()[1]).toContain('Write tests')
      expect(screen.getAllByRole('option')[1]).toHaveClass('active')
      expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id)
      await userEvent.keyboard('{Enter}')
      expect(onChange).toHaveBeenCalledWith(2)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('puts the ID match first then title matches in list order, without duplicates', async () => {
      mockTasks.push({ id: 5, title: 'Plan 1 thing', status: 'Todo' })
      renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, '1')
      const names = optionNames()
      expect(names[1]).toContain('Fix login bug')
      expect(names[2]).toContain('Plan 1 thing')
      expect(names.filter(n => n?.includes('Fix login bug'))).toHaveLength(1)
    })

    it('keeps the ID match first and the list at 10 options when 11 titles also match', async () => {
      for (let i = 0; i < 11; i++) mockTasks.push({ id: 100 + i, title: `Item 42 number ${i}`, status: 'Todo' })
      mockTasks.push({ id: 42, title: 'Fix login', status: 'Todo' })
      renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, '42')
      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(11) // None + 10
      expect(options[1]).toHaveTextContent('#42 Fix login')
    })

    it('does not match #142 for "42" and shows the empty state', async () => {
      mockTasks.push({ id: 142, title: 'Hundred', status: 'Todo' })
      renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, '42')
      expect(screen.getByText('No matching tasks')).toBeInTheDocument()
    })

    it('highlights nothing and Enter does nothing for an ID with no match, even with title matches', async () => {
      mockTasks.push({ id: 6, title: 'Ticket 999 follow-up', status: 'Todo' })
      const { onChange } = renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, '999')
      expect(screen.getByText(/Ticket 999 follow-up/)).toBeInTheDocument()
      expect(screen.getAllByRole('option').some(o => o.classList.contains('active'))).toBe(false)
      expect(input).not.toHaveAttribute('aria-activedescendant')
      await userEvent.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('highlights nothing for non-ID text', async () => {
      renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, 'login')
      expect(screen.getAllByRole('option').some(o => o.classList.contains('active'))).toBe(false)
    })

    it('arrow keys still move from the auto-highlighted ID match', async () => {
      const { onChange } = renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, '2')
      await userEvent.keyboard('{ArrowUp}')
      expect(screen.getByText('None')).toHaveClass('active')
      await userEvent.keyboard('{ArrowDown}{Enter}')
      expect(onChange).toHaveBeenCalledWith(2)
    })

    it('drops the ID highlight when a refetch removes the matched task, so Enter cannot select another', async () => {
      mockTasks.push({ id: 7, title: 'Plan 2 items', status: 'Todo' })
      const { onChange, rerender } = renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, '2')
      expect(screen.getAllByRole('option')[1]).toHaveClass('active')

      // Refetch: task 2 is gone (new array identity), so index 1 now holds the title match "Plan 2 items".
      vi.mocked(useTasksQuery).mockReturnValue({
        data: { data: mockTasks.filter(t => t.id !== 2) },
      } as unknown as ReturnType<typeof useTasksQuery>)
      rerender(<TaskTypeahead value={null} onChange={onChange} />)

      expect(screen.getByText(/Plan 2 items/)).toBeInTheDocument()
      expect(screen.getAllByRole('option').some(o => o.classList.contains('active'))).toBe(false)
      await userEvent.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('matches a title containing "#2" for typed "#2" alongside the ID match', async () => {
      mockTasks.push({ id: 9, title: 'Ref #2 doc', status: 'Todo' })
      renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, '#2')
      const names = optionNames()
      expect(names[1]).toContain('Write tests')
      expect(names[2]).toContain('Ref #2 doc')
    })

    it('matches an ID delivered as a string and selects it as a number', async () => {
      mockTasks.push({ id: '77' as unknown as number, title: 'String id task', status: 'Todo' })
      const { onChange } = renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, '#77')
      expect(optionNames()[1]).toContain('String id task')
      await userEvent.keyboard('{Enter}')
      expect(onChange).toHaveBeenCalledWith(77)
    })

    it('shows the first 10 tasks for whitespace-only input', async () => {
      for (let i = 0; i < 12; i++) mockTasks.push({ id: 300 + i, title: `Extra ${i}`, status: 'Todo' })
      renderTypeahead(null)
      const input = await open()
      await userEvent.type(input, '   ')
      expect(screen.getAllByRole('option')).toHaveLength(11)
    })

    it('shows the first 10 tasks for empty input', async () => {
      for (let i = 0; i < 12; i++) mockTasks.push({ id: 200 + i, title: `Extra ${i}`, status: 'Todo' })
      renderTypeahead(null)
      await open()
      expect(screen.getAllByRole('option')).toHaveLength(11)
    })
  })
})
