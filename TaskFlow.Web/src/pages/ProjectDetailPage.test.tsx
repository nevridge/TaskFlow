import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProjectDetailPage } from './ProjectDetailPage'
import type { ProjectResponseDto, ProjectTaskDto } from '@/api/projects'

vi.mock('@/hooks/useProjects', () => ({
  useProjectQuery: vi.fn(),
  useProjectTasksQuery: vi.fn(),
  useUpdateProjectMutation: vi.fn(),
}))

import { useProjectQuery, useProjectTasksQuery, useUpdateProjectMutation } from '@/hooks/useProjects'

const project: ProjectResponseDto = {
  id: 7,
  name: 'Alpha',
  description: 'Alpha desc',
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
  openTaskCount: 1,
  completedTaskCount: 2,
}

const task = (over: Partial<ProjectTaskDto>): ProjectTaskDto => ({
  id: 1,
  title: 'Task one',
  isComplete: false,
  status: 'Todo',
  priority: 'High',
  projectId: 7,
  projectName: 'Alpha',
  ...over,
})

const updateAsync = vi.fn()

function mockProject(state: Record<string, unknown>) {
  vi.mocked(useProjectQuery).mockReturnValue({ data: undefined, isLoading: false, isError: false, ...state } as never)
}
function mockTasks(state: Record<string, unknown>) {
  vi.mocked(useProjectTasksQuery).mockReturnValue({ data: undefined, isLoading: false, isError: false, ...state } as never)
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateAsync.mockResolvedValue({})
    vi.mocked(useUpdateProjectMutation).mockReturnValue({ mutateAsync: updateAsync, isPending: false } as never)
    mockProject({ data: { data: project } })
    mockTasks({ data: { data: [] } })
  })

  it('renders the project header with counts and description', () => {
    renderAt('/projects/7')
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByText('1 open · 2 completed')).toBeInTheDocument()
    expect(screen.getByText('Alpha desc')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to projects' })).toHaveAttribute('href', '/projects')
    expect(useProjectQuery).toHaveBeenCalledWith(7)
  })

  it('shows the Archived badge outside the h1 accessible name', () => {
    mockProject({ data: { data: { ...project, isArchived: true } } })
    renderAt('/projects/7')
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('shows loading state', () => {
    mockProject({ isLoading: true })
    renderAt('/projects/7')
    expect(screen.getByRole('status')).toHaveTextContent('Loading project')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('shows not found when the project query errors (including network errors)', () => {
    mockProject({ isError: true })
    renderAt('/projects/7')
    expect(screen.getByRole('alert')).toHaveTextContent('Project not found.')
    expect(screen.getByRole('link', { name: 'Back to projects' })).toHaveAttribute('href', '/projects')
  })

  it('keeps the project header and shows a tasks error when only the tasks query fails', () => {
    mockTasks({ isError: true })
    renderAt('/projects/7')
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByText('Failed to load tasks.')).toBeInTheDocument()
    expect(screen.queryByText('Project not found.')).not.toBeInTheDocument()
  })

  it('shows not found for an invalid id', () => {
    renderAt('/projects/abc')
    expect(screen.getByRole('alert')).toHaveTextContent('Project not found.')
    expect(useProjectQuery).toHaveBeenCalledWith(NaN)
  })

  it('shows not found when the response has no project', () => {
    mockProject({ data: { data: undefined } })
    renderAt('/projects/7')
    expect(screen.getByRole('alert')).toHaveTextContent('Project not found.')
  })

  it('lists tasks from the project with links, status, priority and due date', () => {
    mockTasks({
      data: {
        data: [
          task({ id: 1, title: 'Task one', status: 'Todo', priority: 'High', dueDate: '2026-03-05T00:00:00Z' }),
          task({ id: 2, title: 'Task two', status: 'Completed', priority: 'Low' }),
          task({ id: 3, title: 'Task three', status: 'Draft', priority: 'Medium' }),
        ],
      },
    })
    renderAt('/projects/7')
    expect(screen.getByRole('link', { name: 'Task one' })).toHaveAttribute('href', '/tasks/1')
    expect(screen.getByText('Todo')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toHaveClass('p-badge--completed')
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Priority: High')).toBeInTheDocument()
    expect(screen.getByText(/Due Mar 5, 2026/)).toBeInTheDocument()
  })

  it('shows the empty tasks copy exactly', () => {
    renderAt('/projects/7')
    expect(screen.getByText('No tasks in this project yet')).toBeInTheDocument()
  })

  it('shows tasks loading state', () => {
    mockTasks({ isLoading: true })
    renderAt('/projects/7')
    expect(screen.getByRole('status')).toHaveTextContent('Loading tasks')
  })

  it('edit uses the full-replace payload, closes and refocuses Edit', async () => {
    const user = userEvent.setup()
    renderAt('/projects/7')
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    expect(screen.getByLabelText('Name')).toHaveFocus()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 7,
      data: { name: 'Renamed', description: 'Alpha desc', isArchived: false },
    })
    expect(await screen.findByRole('button', { name: 'Edit Alpha' })).toHaveFocus()
  })

  it('renders exactly one h1 in edit mode', async () => {
    const user = userEvent.setup()
    renderAt('/projects/7')
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument()
  })

  it('editing an archived project preserves isArchived true', async () => {
    const user = userEvent.setup()
    mockProject({ data: { data: { ...project, isArchived: true } } })
    renderAt('/projects/7')
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 7,
      data: { name: 'Alpha', description: 'Alpha desc', isArchived: true },
    })
  })

  it('edit 409 shows the message and keeps the form open', async () => {
    const user = userEvent.setup()
    updateAsync.mockRejectedValue({ message: 'Name taken' })
    renderAt('/projects/7')
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name taken')
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('cancel closes the editor without saving', async () => {
    const user = userEvent.setup()
    renderAt('/projects/7')
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(updateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument()
  })
})
