import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TaskListRow } from './TaskListRow'

type TaskProp = Parameters<typeof TaskListRow>[0]['task']
type TaskHandler = Parameters<typeof TaskListRow>[0]['onEdit']

const baseTask: TaskProp = {
  id: 42,
  title: 'Fix login bug',
  description: 'Users cannot log in',
  status: 'todo',
  priority: 'high',
  dueDate: null,
  isComplete: false,
}

function renderRow(
  task: TaskProp = baseTask,
  overrides: {
    onEdit?: TaskHandler
    onDelete?: TaskHandler
    onStatusCycle?: TaskHandler
  } = {},
) {
  const onEdit = overrides.onEdit ?? vi.fn()
  const onDelete = overrides.onDelete ?? vi.fn()
  const onStatusCycle = overrides.onStatusCycle ?? vi.fn()
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <TaskListRow
            task={task}
            onEdit={onEdit}
            onHistory={vi.fn<TaskHandler>()}
            onDelete={onDelete}
            onStatusCycle={onStatusCycle}
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
    renderRow(baseTask, { onEdit })
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(baseTask)
  })

  it('calls onDelete when delete button is clicked', async () => {
    const onDelete = vi.fn()
    renderRow(baseTask, { onDelete })
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith(baseTask)
  })

  it('calls onStatusCycle when status badge is clicked', async () => {
    const onStatusCycle = vi.fn()
    renderRow(baseTask, { onStatusCycle })
    await userEvent.click(screen.getByRole('button', { name: /todo/i }))
    expect(onStatusCycle).toHaveBeenCalledWith(baseTask)
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

  it('renders unaffected when only childTaskCount is present (no childCount field)', () => {
    const task = { ...baseTask, childTaskCount: 3 }
    renderRow(task)
    expect(screen.getByRole('link', { name: 'Fix login bug' })).toBeInTheDocument()
    expect(screen.getByText('todo')).toBeInTheDocument()

    // @ts-expect-error childCount was removed from TaskRowModel — this must fail to compile
    // if the field is ever reintroduced, since the component never reads it at runtime.
    const withRemovedField: TaskProp = { ...baseTask, childCount: 3 }
    expect(withRemovedField).toBeTruthy()
  })

  describe('overdue indicator', () => {
    const pastDate = '2020-01-01T00:00:00Z'

    it('marks past-due incomplete tasks as overdue', () => {
      const task = { ...baseTask, dueDate: pastDate, status: 'todo' }
      renderRow(task)
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
