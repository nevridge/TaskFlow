import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ProjectsPage } from './ProjectsPage'
import type { ProjectResponseDto } from '@/api/projects'

vi.mock('@/hooks/useProjects', () => ({
  useProjectsQuery: vi.fn(),
  useCreateProjectMutation: vi.fn(),
  useUpdateProjectMutation: vi.fn(),
}))

import { useProjectsQuery, useCreateProjectMutation, useUpdateProjectMutation } from '@/hooks/useProjects'

const make = (over: Partial<ProjectResponseDto>): ProjectResponseDto => ({
  id: 1,
  name: 'Alpha',
  description: 'Alpha desc',
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
  openTaskCount: 3,
  completedTaskCount: 4,
  ...over,
})

const alpha = make({})
const beta = make({ id: 2, name: 'Beta', description: null, isArchived: true, openTaskCount: 0, completedTaskCount: 1 })

const createAsync = vi.fn()
const updateAsync = vi.fn()
const refetch = vi.fn()

function mockQuery(state: Record<string, unknown>) {
  vi.mocked(useProjectsQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch,
    ...state,
  } as never)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  )
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createAsync.mockResolvedValue({})
    updateAsync.mockResolvedValue({})
    vi.mocked(useCreateProjectMutation).mockReturnValue({ mutateAsync: createAsync, isPending: false } as never)
    vi.mocked(useUpdateProjectMutation).mockReturnValue({ mutateAsync: updateAsync, isPending: false } as never)
    mockQuery({ data: { data: [alpha, beta] } })
  })

  it('lists active projects with name, open and completed counts', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/projects/1')
    expect(screen.getByText('3 open · 4 completed')).toBeInTheDocument()
  })

  it('hides archived by default and shows them when toggled', async () => {
    const user = userEvent.setup()
    renderPage()
    const toggle = screen.getByLabelText('Show archived')
    expect(toggle).not.toBeChecked()
    expect(screen.queryByRole('link', { name: 'Beta' })).not.toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByRole('link', { name: 'Beta' })).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unarchive Beta' })).toBeInTheDocument()
  })

  it('writes nothing to localStorage', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderPage()
    await user.click(screen.getByLabelText('Show archived'))
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('shows loading state', () => {
    mockQuery({ isLoading: true })
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading projects')
  })

  it('shows error state with retry', async () => {
    const user = userEvent.setup()
    mockQuery({ isError: true })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load projects.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows the no projects empty state', () => {
    mockQuery({ data: { data: [] } })
    renderPage()
    expect(screen.getByText('No projects yet. Create one above.')).toBeInTheDocument()
  })

  it('shows archived hint when only archived exist and the toggle is off', () => {
    mockQuery({ data: { data: [beta] } })
    renderPage()
    expect(screen.getByText(/No active projects/)).toHaveTextContent('see 1 archived project.')
  })

  it('handles an undefined payload as empty', () => {
    mockQuery({ data: undefined })
    renderPage()
    expect(screen.getByText('No projects yet. Create one above.')).toBeInTheDocument()
  })

  it('creates a project with name and description and clears the form', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Name'), 'Gamma')
    await user.type(screen.getByLabelText('Description'), 'G desc')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(createAsync).toHaveBeenCalledWith({ name: 'Gamma', description: 'G desc' })
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('sends an empty description as null', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Name'), 'Gamma')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(createAsync).toHaveBeenCalledWith({ name: 'Gamma', description: null })
  })

  it('does not call the API for an invalid name', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(createAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.')
  })

  it('create 409 shows the API message, keeps input and adds no row', async () => {
    const user = userEvent.setup()
    createAsync.mockRejectedValue({ message: 'A project with that name already exists.' })
    renderPage()
    await user.type(screen.getByLabelText('Name'), 'Alpha')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A project with that name already exists.')
    expect(screen.getByLabelText('Name')).toHaveValue('Alpha')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('rename sends name, description and isArchived', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    const row = screen.getByRole('listitem')
    const name = within(row).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Alpha 2')
    await user.click(within(row).getByRole('button', { name: 'Save' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 1,
      data: { name: 'Alpha 2', description: 'Alpha desc', isArchived: false },
    })
  })

  it('edit description sends all three fields, clearing to null', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.clear(within(screen.getByRole('listitem')).getByLabelText('Description'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 1,
      data: { name: 'Alpha', description: null, isArchived: false },
    })
  })

  it('rename 409 shows the API message and keeps the form open', async () => {
    const user = userEvent.setup()
    updateAsync.mockRejectedValue({ message: 'Name taken' })
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name taken')
    expect(within(screen.getByRole('listitem')).getByLabelText('Name')).toHaveValue('Alpha')
  })

  it('archive sends isArchived true with current name and description', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Archive Alpha' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 1,
      data: { name: 'Alpha', description: 'Alpha desc', isArchived: true },
    })
  })

  it('unarchive sends isArchived false', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByLabelText('Show archived'))
    await user.click(screen.getByRole('button', { name: 'Unarchive Beta' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 2,
      data: { name: 'Beta', description: null, isArchived: false },
    })
  })

  it('disables Create while the create mutation is in flight', async () => {
    const user = userEvent.setup()
    let resolve: (v: unknown) => void = () => {}
    createAsync.mockReturnValue(new Promise((r) => { resolve = r }))
    renderPage()
    await user.type(screen.getByLabelText('Name'), 'Gamma')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled()
    resolve({})
  })

  it('disables Save while a list-page edit is in flight', async () => {
    const user = userEvent.setup()
    let resolve: (v: unknown) => void = () => {}
    updateAsync.mockReturnValue(new Promise((r) => { resolve = r }))
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    resolve({})
  })

  it('returns focus to the Edit button after a successful save', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Edit Alpha' })).toHaveFocus()
  })

  it('disables row actions while an update is pending', () => {
    vi.mocked(useUpdateProjectMutation).mockReturnValue({ mutateAsync: updateAsync, isPending: true } as never)
    renderPage()
    expect(screen.getByRole('button', { name: 'Edit Alpha' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Archive Alpha' })).toBeDisabled()
  })

  it('renders a long name in a wrapping link', () => {
    const long = 'x'.repeat(100)
    mockQuery({ data: { data: [make({ name: long })] } })
    renderPage()
    expect(screen.getByRole('link', { name: long })).toHaveClass('p-row-name')
  })
})
