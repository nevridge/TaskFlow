import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ProjectRow } from './ProjectRow'
import type { ProjectResponseDto } from '@/api/projects'

const project: ProjectResponseDto = {
  id: 3,
  name: 'Alpha',
  description: 'About alpha',
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
  openTaskCount: 2,
  completedTaskCount: 5,
}

function setup(p: ProjectResponseDto = project, overrides: Partial<React.ComponentProps<typeof ProjectRow>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onToggleArchive = vi.fn().mockResolvedValue(undefined)
  render(
    <MemoryRouter>
      <ul>
        <ProjectRow project={p} onSave={onSave} onToggleArchive={onToggleArchive} {...overrides} />
      </ul>
    </MemoryRouter>,
  )
  return { onSave, onToggleArchive }
}

describe('ProjectRow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders name link, counts and description', () => {
    setup()
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/projects/3')
    expect(screen.getByText('2 open · 5 completed')).toBeInTheDocument()
    expect(screen.getByText('About alpha')).toBeInTheDocument()
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
  })

  it('shows Archived badge and Unarchive for archived projects', () => {
    setup({ ...project, isArchived: true })
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unarchive Alpha' })).toBeInTheDocument()
  })

  it('archive calls onToggleArchive', async () => {
    const user = userEvent.setup()
    const { onToggleArchive } = setup()
    await user.click(screen.getByRole('button', { name: 'Archive Alpha' }))
    expect(onToggleArchive).toHaveBeenCalledWith(project)
  })

  it('shows an error when archive fails', async () => {
    const user = userEvent.setup()
    setup(project, { onToggleArchive: vi.fn().mockRejectedValue({ message: 'Boom' }) })
    await user.click(screen.getByRole('button', { name: 'Archive Alpha' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
  })

  it('edit opens the form, saves, closes and returns focus to Edit', async () => {
    const user = userEvent.setup()
    const { onSave } = setup()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    const name = screen.getByLabelText('Name')
    expect(name).toHaveFocus()
    await user.clear(name)
    await user.type(name, 'Beta')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(project, { name: 'Beta', description: 'About alpha' })
    expect(await screen.findByRole('link', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Alpha' })).toHaveFocus()
  })

  it('stays open and shows the API message when save fails', async () => {
    const user = userEvent.setup()
    setup(project, { onSave: vi.fn().mockRejectedValue({ message: 'Name already exists' }) })
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name already exists')
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('cancel discards and returns focus to Edit', async () => {
    const user = userEvent.setup()
    const { onSave } = setup()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.type(screen.getByLabelText('Name'), 'zzz')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit Alpha' })).toHaveFocus()
  })

  it('disables buttons when disabled', () => {
    setup(project, { disabled: true })
    expect(screen.getByRole('button', { name: 'Edit Alpha' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Archive Alpha' })).toBeDisabled()
  })

  it('adds "(M blocked)" to the open count only when M > 0', () => {
    setup({ ...project, openTaskCount: 7, completedTaskCount: 5, blockedCount: 2 })
    expect(screen.getByText('7 open (2 blocked) · 5 completed')).toBeInTheDocument()
  })

  it('hides the blocked part when blockedCount is 0 or missing', () => {
    setup({ ...project, blockedCount: 0 })
    expect(screen.getByText('2 open · 5 completed')).toBeInTheDocument()
  })
})
