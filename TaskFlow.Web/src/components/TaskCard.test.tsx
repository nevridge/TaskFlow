import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TaskCard } from './TaskCard'
import type { TaskItemResponseDto } from '@/api/client/types.gen'

const task: TaskItemResponseDto = {
  id: 1,
  title: 'Fix login bug',
  description: 'Users cannot log in',
  status: 'todo',
  priority: 'high',
  dueDate: '2026-05-01T00:00:00Z',
}

function renderCard(onEdit = vi.fn(), onDelete = vi.fn(), taskOverride: TaskItemResponseDto = task) {
  return render(
    <MemoryRouter>
      <TaskCard task={taskOverride} onEdit={onEdit} onDelete={onDelete} />
    </MemoryRouter>
  )
}

describe('TaskCard', () => {
  it('renders the task title', () => {
    renderCard()
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
  })

  it('renders status and priority badges', () => {
    renderCard()
    expect(screen.getByText('todo')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('calls onEdit when edit button is clicked', async () => {
    const onEdit = vi.fn()
    renderCard(onEdit)
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(task)
  })

  it('calls onDelete when delete button is clicked', async () => {
    const onDelete = vi.fn()
    renderCard(vi.fn(), onDelete)
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith(task)
  })

  describe('project badge', () => {
    it('shows the project name with its original case and a title', () => {
      renderCard(vi.fn(), vi.fn(), { ...task, projectId: 3, projectName: 'Alpha Launch' })
      const badge = screen.getByText('Alpha Launch')
      expect(badge).toHaveAttribute('title', 'Alpha Launch')
      expect(badge).toHaveClass('t-badge-project')
    })

    it('carries the truncation class and the full name in the title for long names', () => {
      const longName = 'A very long project name that should be truncated with an ellipsis in the card'
      renderCard(vi.fn(), vi.fn(), { ...task, projectId: 3, projectName: longName })
      const badge = screen.getByText(longName)
      expect(badge).toHaveClass('t-badge-project')
      expect(badge).toHaveAttribute('title', longName)
    })

    it.each([
      ['null project', { projectId: null, projectName: null }],
      ['undefined project', {}],
      ['projectId without a name', { projectId: 3, projectName: null }],
      ['empty name', { projectId: 3, projectName: '' }],
    ])('renders no badge for %s', (_label, extra) => {
      const { container } = renderCard(vi.fn(), vi.fn(), { ...task, ...extra })
      expect(container.querySelector('.t-badge-project')).toBeNull()
    })
  })
})
