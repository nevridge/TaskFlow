import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
    expect(optionTexts).toContain('Write tests')
    expect(optionTexts).not.toContain('Fix login bug')
    expect(optionTexts).not.toContain('Deploy to production')
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

    it('scrolls the dropdown and the active option into view', async () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      renderTypeahead(null)
      await userEvent.click(screen.getByRole('combobox'))
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      scroll.mockClear()
      await userEvent.keyboard('{ArrowDown}')
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    })

    it('does not give the empty-state row an option role', async () => {
      renderTypeahead(null)
      const input = screen.getByRole('combobox')
      await userEvent.click(input)
      await userEvent.type(input, 'zzznomatch')
      expect(screen.getAllByRole('option')).toHaveLength(1)
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
})
