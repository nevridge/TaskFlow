import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TaskListRow } from './TaskListRow'
import type { TaskItemResponseDto } from '@/api/client/types.gen'

const baseTask: TaskItemResponseDto = {
  id: 42,
  title: 'Fix login bug',
  description: 'Users cannot log in',
  status: 'todo',
  priority: 'high',
  dueDate: null,
  isComplete: false,
}

function renderRow(
  task: TaskItemResponseDto = baseTask,
  isOnTodayJournal = false,
  onEdit = vi.fn(),
  onDelete = vi.fn(),
) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <TaskListRow
            task={task}
            isOnTodayJournal={isOnTodayJournal}
            onEdit={onEdit}
            onHistory={vi.fn()}
            onDelete={onDelete}
          />
        </tbody>
      </table>
    </MemoryRouter>
  )
}

describe('TaskListRow', () => {
  it('renders the task title as a link', () => {
    renderRow()
    expect(screen.getByRole('link', { name: 'Fix login bug' })).toBeInTheDocument()
  })

  it('renders status and priority badges', () => {
    renderRow()
    expect(screen.getByText('todo')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('calls onEdit when edit button is clicked', async () => {
    const onEdit = vi.fn()
    renderRow(baseTask, false, onEdit)
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(baseTask)
  })

  it('calls onDelete when delete button is clicked', async () => {
    const onDelete = vi.fn()
    renderRow(baseTask, false, vi.fn(), onDelete)
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith(baseTask)
  })

  it('shows journal indicator when task is on today journal', () => {
    renderRow(baseTask, true)
    expect(screen.getByLabelText("On today's journal")).toBeInTheDocument()
  })

  it('does not show journal indicator when task is not on today journal', () => {
    renderRow(baseTask, false)
    expect(screen.queryByLabelText("On today's journal")).not.toBeInTheDocument()
  })

  it('shows formatted due date when present', () => {
    const task = { ...baseTask, dueDate: '2026-06-15T12:00:00Z' }
    renderRow(task)
    expect(screen.getByText(/Jun 15, 2026/)).toBeInTheDocument()
  })

  it('shows em dash when no due date', () => {
    renderRow({ ...baseTask, dueDate: null })
    expect(screen.getByText('—', { selector: '.t-list-cell--due .t-list-empty' })).toBeInTheDocument()
  })

  describe('overdue indicator', () => {
    const pastDate = '2020-01-01T00:00:00Z'

    it('marks past-due incomplete tasks as overdue', () => {
      const task = { ...baseTask, dueDate: pastDate, status: 'todo' }
      renderRow(task)
      // The overdue icon (!) should be present
      expect(screen.getByText('!', { selector: '.t-overdue-icon' })).toBeInTheDocument()
    })

    it('does not mark completed tasks as overdue even if past due', () => {
      const task = { ...baseTask, dueDate: pastDate, status: 'Completed' }
      renderRow(task)
      expect(screen.queryByText('!', { selector: '.t-overdue-icon' })).not.toBeInTheDocument()
    })

    it('does not mark future tasks as overdue', () => {
      const task = { ...baseTask, dueDate: '2099-12-31T00:00:00Z', status: 'todo' }
      renderRow(task)
      expect(screen.queryByText('!', { selector: '.t-overdue-icon' })).not.toBeInTheDocument()
    })
  })
})
