import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TaskListRow } from './TaskListRow'

type Props = Parameters<typeof TaskListRow>[0]
type TaskProp = Props['task']

const base: TaskProp = { id: 42, title: 'Fix login bug', status: 'InProgress', priority: 'High', dueDate: null }

function renderRow(task: TaskProp, extra: Partial<Props> = {}) {
  render(
    <MemoryRouter>
      <table>
        <tbody>
          <TaskListRow
            task={task}
            onEdit={vi.fn()}
            onHistory={vi.fn()}
            onDelete={vi.fn()}
            onStatusCycle={vi.fn()}
            {...extra}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  )
}

describe('TaskListRow In Progress', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows an "In Progress" badge with its own class', () => {
    renderRow(base)
    expect(screen.getByText('In Progress')).toHaveClass('t-badge-inprogress')
  })

  it('names the current and next status on the cycle control', () => {
    renderRow(base)
    expect(screen.getByRole('button', { name: 'Status: In Progress. Click to change to Completed.' })).toBeInTheDocument()
  })

  it('names To-do then In Progress for a Todo row', () => {
    renderRow({ ...base, status: 'Todo' })
    expect(screen.getByRole('button', { name: 'Status: To-do. Click to change to In Progress.' })).toBeInTheDocument()
  })

  it('offers Block for an InProgress row', () => {
    renderRow(base, { onBlock: vi.fn() })
    expect(screen.getByRole('button', { name: /^block/i })).toBeInTheDocument()
  })

  it('does not offer Block for Draft', () => {
    renderRow({ ...base, status: 'Draft' }, { onBlock: vi.fn() })
    expect(screen.queryByRole('button', { name: /^block/i })).not.toBeInTheDocument()
  })
})
