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
})
