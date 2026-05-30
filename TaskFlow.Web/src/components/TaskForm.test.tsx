import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskForm } from './TaskForm'

beforeEach(() => {
  vi.clearAllMocks()
})

function renderForm(task?: Parameters<typeof TaskForm>[0]['task'], onSubmit = vi.fn(), onCancel = vi.fn()) {
  return render(<TaskForm task={task} onSubmit={onSubmit} onCancel={onCancel} />)
}

describe('TaskForm', () => {
  it('renders title input', () => {
    renderForm()
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument()
  })

  it('pre-fills fields when editing an existing task', () => {
    const task = {
      id: 1, title: 'Existing task', description: 'Some desc', status: 'todo', priority: 'medium', isComplete: false,
    }
    renderForm(task)
    expect(screen.getByDisplayValue('Existing task')).toBeInTheDocument()
  })

  it('calls onSubmit with form data when submitted', async () => {
    const onSubmit = vi.fn()
    renderForm(undefined, onSubmit)
    await userEvent.type(screen.getByLabelText(/title/i), 'New task')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'New task' }))
  })

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn()
    renderForm(undefined, vi.fn(), onCancel)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
