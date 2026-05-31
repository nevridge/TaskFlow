import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockTasks = [
  { id: 1, title: 'Fix login bug', status: 'Todo', isComplete: false },
  { id: 2, title: 'Write tests', status: 'Todo', isComplete: false },
  { id: 3, title: 'Deploy to production', status: 'Completed', isComplete: true },
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
})
